import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import { User }             from './entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
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
