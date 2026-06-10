import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import { ConfigService }    from '@nestjs/config';
import { SiweMessage }      from 'siwe';
import { v4 as uuidv4 }     from 'uuid';
import { User }             from './entities/user.entity';
import { UserWallet }       from './entities/user-wallet.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { LinkWalletDto }    from './dto/link-wallet.dto';
import { RedisService }     from '../../shared/redis/redis.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserWallet)
    private readonly walletRepo: Repository<UserWallet>,
    private readonly config:       ConfigService,
    private readonly redisService: RedisService,
  ) {}

  // ─── getProfile ────────────────────────────────────────────────────────────

  /**
   * Lấy profile của user hiện tại.
   * Trả về đúng các field safe để expose ra FE (không bao gồm role, email raw).
   */
  async getProfile(userId: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: [
        'id', 'wallet_address', 'username', 'bio',
        'avatar_url', 'twitter_handle', 'is_verified',
        'role', 'created_at',
      ],
    });
    if (!user) throw new NotFoundException('User không tồn tại');
    return user;
  }

  // ─── updateProfile ─────────────────────────────────────────────────────────

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User không tồn tại');

    if (dto.username     !== undefined) user.username       = dto.username;
    if (dto.bio          !== undefined) user.bio            = dto.bio;
    if (dto.avatar_url   !== undefined) user.avatar_url     = dto.avatar_url;
    if (dto.twitter_handle !== undefined) user.twitter_handle = dto.twitter_handle;

    const saved = await this.userRepo.save(user);
    this.logger.log(`Profile updated: user=${userId}`);

    // Return safe subset
    return this.getProfile(saved.id);
  }

  // ═══ Multi-wallet linking ═══════════════════════════════════════════════════
  //  1 tài khoản ↔ nhiều ví. Liên kết yêu cầu ký SIWE bằng chính ví đó
  //  (proof of ownership) — cùng cơ chế nonce Redis chống replay như login.

  // ─── listWallets ───────────────────────────────────────────────────────────

  async listWallets(userId: string): Promise<UserWallet[]> {
    return this.walletRepo.find({
      where:  { user_id: userId },
      order:  { is_primary: 'DESC', created_at: 'ASC' },
      select: ['id', 'wallet_address', 'label', 'is_primary', 'created_at'],
    });
  }

  // ─── getLinkWalletNonce ────────────────────────────────────────────────────

  /**
   * Bước 1 của link ví: phát SIWE message cho ví muốn liên kết.
   * KHÔNG tạo users row (khác /auth/nonce) — ví này sẽ thuộc về user hiện tại.
   */
  async getLinkWalletNonce(userId: string, walletAddress: string): Promise<{
    nonce:   string;
    message: string;
  }> {
    const normalized = walletAddress.toLowerCase();
    await this.assertWalletLinkable(userId, normalized);

    const nonce   = uuidv4().replace(/-/g, '');
    const chainId = this.config.get<number>('CHAIN_ID', 8453);

    const siwe = new SiweMessage({
      domain:         this.config.get('APP_DOMAIN', 'artcurve.io'),
      address:        walletAddress,
      statement:      'Link this wallet to your ArtCurve account. This will not trigger a blockchain transaction.',
      uri:            this.config.get('APP_URI', 'https://artcurve.io'),
      version:        '1',
      chainId,
      nonce,
      issuedAt:       new Date().toISOString(),
      expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    await this.redisService.setNonce(normalized, nonce);
    this.logger.log(`[Wallets] Link nonce issued: user=${userId} wallet=${normalized}`);
    return { nonce, message: siwe.prepareMessage() };
  }

  // ─── linkWallet ────────────────────────────────────────────────────────────

  /** Bước 2: verify chữ ký SIWE và lưu liên kết. */
  async linkWallet(userId: string, dto: LinkWalletDto): Promise<UserWallet[]> {
    const normalized = dto.wallet_address.toLowerCase();

    // Atomic consume nonce — chống replay (GETDEL)
    const storedNonce = await this.redisService.consumeNonce(normalized);
    if (!storedNonce) {
      throw new UnauthorizedException(
        'Nonce hết hạn hoặc không tồn tại. Gọi lại bước nonce.',
      );
    }

    let siweMessage: SiweMessage;
    try {
      siweMessage = new SiweMessage(dto.message);
    } catch {
      throw new BadRequestException('SIWE message không hợp lệ.');
    }
    try {
      await siweMessage.verify({
        signature: dto.signature,
        domain:    this.config.get('APP_DOMAIN', 'artcurve.io'),
        nonce:     storedNonce,
      });
    } catch (err) {
      throw new UnauthorizedException(
        `Xác thực chữ ký thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (siweMessage.address.toLowerCase() !== normalized) {
      throw new UnauthorizedException('Địa chỉ trong message không khớp wallet_address.');
    }

    // Re-check sau verify — tránh race với request link song song
    await this.assertWalletLinkable(userId, normalized);

    await this.walletRepo.insert({
      user_id:        userId,
      wallet_address: normalized,
      label:          dto.label ?? null,
      is_primary:     false,
    });
    this.logger.log(`[Wallets] Linked: user=${userId} wallet=${normalized}`);
    return this.listWallets(userId);
  }

  // ─── unlinkWallet ──────────────────────────────────────────────────────────

  async unlinkWallet(userId: string, walletAddress: string): Promise<UserWallet[]> {
    const normalized = walletAddress.toLowerCase();
    const wallet = await this.walletRepo.findOne({
      where: { user_id: userId, wallet_address: normalized },
    });
    if (!wallet) throw new NotFoundException('Ví này chưa được liên kết với tài khoản.');
    if (wallet.is_primary) {
      throw new BadRequestException('Không thể gỡ ví primary — đây là ví định danh tài khoản.');
    }
    await this.walletRepo.delete({ id: wallet.id });
    this.logger.log(`[Wallets] Unlinked: user=${userId} wallet=${normalized}`);
    return this.listWallets(userId);
  }

  /** Ví chỉ link được khi chưa thuộc tài khoản nào (user_wallets + users). */
  private async assertWalletLinkable(userId: string, normalized: string): Promise<void> {
    const existing = await this.walletRepo.findOne({ where: { wallet_address: normalized } });
    if (existing) {
      throw new ConflictException(
        existing.user_id === userId
          ? 'Ví này đã được liên kết với tài khoản của bạn.'
          : 'Ví này đã thuộc về một tài khoản khác.',
      );
    }
    const owner = await this.userRepo.findOne({ where: { wallet_address: normalized } });
    if (owner && owner.id !== userId) {
      throw new ConflictException(
        'Ví này đã đăng ký như một tài khoản riêng. Hãy đăng nhập bằng ví đó.',
      );
    }
  }

  // ─── getPublicProfile ──────────────────────────────────────────────────────

  /**
   * Public profile theo wallet address — dùng cho trang creator profile
   * và ArtCard creator info trên marketplace.
   */
  async getPublicProfile(walletAddress: string): Promise<Partial<User>> {
    const user = await this.userRepo.findOne({
      where:  { wallet_address: walletAddress.toLowerCase() },
      select: ['id', 'wallet_address', 'username', 'avatar_url', 'is_verified', 'bio', 'twitter_handle', 'created_at'],
    });
    if (!user) throw new NotFoundException(`User với wallet ${walletAddress} không tồn tại`);
    return user;
  }

  // ─── getTopCreators ────────────────────────────────────────────────────────

  /**
   * Danh sách top creators cho trang chủ / marketplace sidebar.
   * Sort theo số artwork đã deploy (ACTIVE/GRADUATED).
   */
  async getTopCreators(limit = 10): Promise<Partial<User>[]> {
    return this.userRepo
      .createQueryBuilder('user')
      .leftJoin('user.artworks', 'artwork', "artwork.status IN ('ACTIVE','TARGET_REACHED','GRADUATED')")
      .select([
        'user.id',
        'user.wallet_address',
        'user.username',
        'user.avatar_url',
        'user.is_verified',
      ])
      .addSelect('COUNT(artwork.id)', 'artwork_count')
      .groupBy('user.id')
      .orderBy('artwork_count', 'DESC')
      .limit(Math.min(limit, 50))
      .getMany();
  }
}
