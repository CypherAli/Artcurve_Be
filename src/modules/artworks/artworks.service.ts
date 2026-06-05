import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Artwork, ArtworkStatus, CurveType } from './entities/artwork.entity';
import { Transaction } from '../trades/entities/transaction.entity';
import {
  CreateArtworkDto,
  UpdateArtworkStatusDto,
  SearchArtworksDto,
} from './dto/create-artwork.dto';
import { PinataService } from './pinata.service';

// ── State machine ─────────────────────────────────────────────────────────────
const VALID_TRANSITIONS: Record<ArtworkStatus, ArtworkStatus[]> = {
  [ArtworkStatus.DRAFT]:          [ArtworkStatus.AI_MODERATING],
  [ArtworkStatus.AI_MODERATING]:  [ArtworkStatus.ACTIVE],
  [ArtworkStatus.ACTIVE]:         [ArtworkStatus.TARGET_REACHED],
  [ArtworkStatus.TARGET_REACHED]: [ArtworkStatus.GRADUATED],
  [ArtworkStatus.GRADUATED]:      [],
};

// ── Reusable SELECT columns (tránh select * tốn băng thông) ───────────────────
const MARKETPLACE_COLS = [
  'artwork.id',
  'artwork.title',
  'artwork.description',
  'artwork.ipfs_metadata_uri',
  'artwork.ticker',
  'artwork.category',
  'artwork.curve_type',
  'artwork.royalty_pct',
  'artwork.init_price',
  'artwork.current_price',
  'artwork.current_supply',
  'artwork.target_cap',
  'artwork.view_count',
  'artwork.status',
  'artwork.created_at',
  'creator.id',
  'creator.wallet_address',
  'creator.username',
  'creator.avatar_url',
  'creator.is_verified',
] as const;

@Injectable()
export class ArtworksService {
  private readonly logger = new Logger(ArtworksService.name);

  constructor(
    @InjectRepository(Artwork)
    private readonly artworkRepo: Repository<Artwork>,

    @InjectRepository(Transaction)
    private readonly txRepo: Repository<Transaction>,

    private readonly dataSource:    DataSource,
    private readonly pinataService: PinataService,
  ) {}

  // ─── createDraftArtwork ────────────────────────────────────────────────────

  /**
   * Bước 1 trong State Machine.
   * Creator upload metadata → lưu DB với status DRAFT.
   * Ticker được auto-generate từ title nếu frontend không truyền.
   */
  async createDraftArtwork(creatorId: string, dto: CreateArtworkDto): Promise<Artwork> {
    const ticker = dto.ticker ?? this.generateTicker(dto.title);

    // Kiểm tra ticker duplicate
    const existing = await this.artworkRepo.findOne({
      where: { ticker },
      select: ['id'],
    });
    if (existing) {
      throw new ConflictException(
        `Ticker "${ticker}" đã được sử dụng. Hãy chọn ticker khác.`,
      );
    }

    const artwork = this.artworkRepo.create({
      creator_id:        creatorId,
      title:             dto.title,
      description:       dto.description    ?? null,
      ipfs_metadata_uri: dto.ipfs_metadata_uri ?? null,
      target_cap:        dto.target_cap,
      ticker,
      category:          dto.category       ?? null,
      royalty_pct:       dto.royalty_pct    ?? '5.00',
      curve_type:        dto.curve_type     ?? CurveType.QUADRATIC,
      init_price:        dto.init_price     ?? '0.00100000',
      status:            ArtworkStatus.DRAFT,
      current_supply:    '0',
      current_price:     dto.init_price     ?? '0.00100000',
    });

    const saved = await this.artworkRepo.save(artwork);
    this.logger.log(`Artwork DRAFT: id=${saved.id} ticker=${ticker} creator=${creatorId}`);
    return saved;
  }

  // ─── getArtworkById ────────────────────────────────────────────────────────

  /**
   * Lấy chi tiết một artwork kèm thông tin creator.
   * Public — không yêu cầu auth.
   * Tự động tăng view_count (fire-and-forget).
   */
  async getArtworkById(id: string): Promise<Artwork> {
    const artwork = await this.artworkRepo
      .createQueryBuilder('artwork')
      .leftJoin('artwork.creator', 'creator')
      .select([
        ...MARKETPLACE_COLS,
        'artwork.contract_address',
        'artwork.updated_at',
      ])
      .where('artwork.id = :id', { id })
      .getOne();

    if (!artwork) throw new NotFoundException(`Artwork ${id} không tồn tại`);

    // Tăng view_count không block response
    this.artworkRepo
      .createQueryBuilder()
      .update()
      .set({ view_count: () => 'view_count + 1' })
      .where('id = :id', { id })
      .execute()
      .catch(() => {});

    return artwork;
  }

  // ─── getMarketplace ────────────────────────────────────────────────────────

  /**
   * Marketplace listing — chỉ ACTIVE artworks.
   * Dùng partial index idx_artworks_active_price.
   */
  async getMarketplace(
    sortBy: 'price' | 'created_at' | 'view_count' = 'created_at',
    page  = 1,
    limit = 20,
  ): Promise<{ data: Artwork[]; total: number; page: number }> {
    const sortCol = {
      price:      'artwork.current_price',
      created_at: 'artwork.created_at',
      view_count: 'artwork.view_count',
    }[sortBy] ?? 'artwork.created_at';

    const [data, total] = await this.artworkRepo
      .createQueryBuilder('artwork')
      .leftJoin('artwork.creator', 'creator')
      .select([...MARKETPLACE_COLS])
      .where('artwork.status = :status', { status: ArtworkStatus.ACTIVE })
      .orderBy(sortCol, 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page };
  }

  // ─── searchArtworks ────────────────────────────────────────────────────────

  /**
   * Tìm kiếm artworks với full-text keyword, category filter, curve filter.
   * Chỉ trả về ACTIVE artworks.
   */
  async searchArtworks(dto: SearchArtworksDto): Promise<{
    data:  Artwork[];
    total: number;
    page:  number;
  }> {
    const page  = dto.page  ?? 1;
    const limit = Math.min(dto.limit ?? 20, 100);

    const sortCol = {
      price:      'artwork.current_price',
      created_at: 'artwork.created_at',
      view_count: 'artwork.view_count',
      supply:     'artwork.current_supply',
    }[dto.sortBy ?? 'created_at'] ?? 'artwork.created_at';

    const qb = this.artworkRepo
      .createQueryBuilder('artwork')
      .leftJoin('artwork.creator', 'creator')
      .select([...MARKETPLACE_COLS])
      .where('artwork.status = :status', { status: ArtworkStatus.ACTIVE });

    if (dto.q) {
      qb.andWhere(
        `(LOWER(artwork.title) LIKE LOWER(:q)
          OR LOWER(artwork.description) LIKE LOWER(:q)
          OR artwork.ticker LIKE UPPER(:ticker))`,
        { q: `%${dto.q}%`, ticker: `%${dto.q.toUpperCase()}%` },
      );
    }

    if (dto.category)   qb.andWhere('artwork.category = :cat',   { cat: dto.category });
    if (dto.curve_type) qb.andWhere('artwork.curve_type = :ct',  { ct:  dto.curve_type });

    const [data, total] = await qb
      .orderBy(sortCol, 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page };
  }

  // ─── getMyArtworks ─────────────────────────────────────────────────────────

  /**
   * Tất cả artworks của creator (kể cả DRAFT) — chỉ creator thấy.
   */
  async getMyArtworks(creatorId: string): Promise<Artwork[]> {
    return this.artworkRepo
      .createQueryBuilder('artwork')
      .select([
        'artwork.id',
        'artwork.title',
        'artwork.ticker',
        'artwork.category',
        'artwork.status',
        'artwork.current_price',
        'artwork.current_supply',
        'artwork.target_cap',
        'artwork.view_count',
        'artwork.created_at',
        'artwork.updated_at',
      ])
      .where('artwork.creator_id = :creatorId', { creatorId })
      .orderBy('artwork.created_at', 'DESC')
      .getMany();
  }

  // ─── updateArtworkStatus ───────────────────────────────────────────────────

  /**
   * Chuyển state machine — validate transition trước khi update.
   * Chuyển sang ACTIVE bắt buộc có contract_address và ipfs_metadata_uri.
   */
  async updateArtworkStatus(
    currentUserId: string,
    artworkId: string,
    dto: UpdateArtworkStatusDto,
  ): Promise<Artwork> {
    const artwork = await this.artworkRepo.findOne({ where: { id: artworkId } });
    if (!artwork) throw new NotFoundException(`Artwork ${artworkId} không tồn tại`);

    // Chỉ creator hoặc admin mới được phép thay đổi trạng thái
    if (artwork.creator_id !== currentUserId) {
      throw new ForbiddenException('Chỉ creator mới được phép cập nhật trạng thái artwork');
    }

    const newStatus = dto.status as ArtworkStatus;
    const allowed   = VALID_TRANSITIONS[artwork.status];

    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Không thể chuyển từ ${artwork.status} → ${newStatus}. ` +
        `Chỉ được phép: [${allowed.join(', ')}]`,
      );
    }

    if (newStatus === ArtworkStatus.ACTIVE) {
      if (!dto.ipfs_metadata_uri)
        throw new BadRequestException('Cần ipfs_metadata_uri khi chuyển sang ACTIVE');
      if (!dto.contract_address)
        throw new BadRequestException('Cần contract_address khi chuyển sang ACTIVE');
      artwork.ipfs_metadata_uri = dto.ipfs_metadata_uri;
      artwork.contract_address  = dto.contract_address;
    }

    artwork.status = newStatus;
    const saved = await this.artworkRepo.save(artwork);
    this.logger.log(`Artwork ${artworkId} → ${newStatus}`);
    return saved;
  }

  // ─── getArtworkTradingHistory ──────────────────────────────────────────────

  async getArtworkTradingHistory(
    artworkId: string,
    page  = 1,
    limit = 20,
  ): Promise<{
    data: {
      tx_hash:         string;
      tx_type:         string;
      share_amount:    string;
      eth_amount:      string;
      price_per_share: string;
      timestamp:       Date;
      trader_wallet:   string;
    }[];
    total:      number;
    page:       number;
    totalPages: number;
  }> {
    const artwork = await this.artworkRepo.findOne({
      where: { id: artworkId },
      select: ['id'],
    });
    if (!artwork) throw new NotFoundException(`Artwork ${artworkId} không tồn tại`);

    const offset = (page - 1) * limit;

    const [rows, countRes]: [any[], [{ count: string }]] = await Promise.all([
      this.dataSource.query(
        `SELECT t.tx_hash, t.tx_type, t.share_amount, t.eth_amount,
                t.price_per_share, t.timestamp,
                u.wallet_address AS trader_wallet
         FROM   transactions t
         INNER  JOIN users u ON t.user_id = u.id
         WHERE  t.artwork_id = $1
         ORDER  BY t.timestamp DESC
         LIMIT  $2 OFFSET $3`,
        [artworkId, limit, offset],
      ),
      this.dataSource.query(
        `SELECT COUNT(*) FROM transactions WHERE artwork_id = $1`,
        [artworkId],
      ),
    ]);

    const total = parseInt(countRes[0].count, 10);

    return {
      data:       rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ─── incrementViewCount ────────────────────────────────────────────────────

  async incrementViewCount(artworkId: string): Promise<void> {
    await this.artworkRepo
      .createQueryBuilder()
      .update()
      .set({ view_count: () => 'view_count + 1' })
      .where('id = :id', { id: artworkId })
      .execute();
  }

  // ─── uploadArtworkMedia ────────────────────────────────────────────────────

  /**
   * Bước chuẩn bị trước createDraftArtwork:
   * 1. Pin ảnh gốc lên IPFS → image_uri
   * 2. Tạo ERC-721 metadata JSON và pin → metadata_uri
   * 3. Trả về cả hai URI cho frontend dùng tiếp
   *
   * Nếu Pinata chưa cấu hình (dev mode), trả về URI mock.
   */
  async uploadArtworkMedia(
    file:        Express.Multer.File,
    title:       string,
    description: string = '',
  ): Promise<{ image_uri: string; metadata_uri: string; gateway_image_url: string }> {
    // Dev fallback khi không có Pinata keys
    if (!this.pinataService.isConfigured) {
      const mockCid = `Qm${Buffer.from(title).toString('hex').slice(0, 44)}`;
      const imageUri    = `ipfs://${mockCid}/image`;
      const metadataUri = `ipfs://${mockCid}/metadata.json`;
      this.logger.warn(`Pinata not configured — returning mock IPFS URIs for "${title}"`);
      return { image_uri: imageUri, metadata_uri: metadataUri, gateway_image_url: '' };
    }

    // 1. Upload ảnh
    const imageUri = await this.pinataService.pinFile(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    // 2. Build và upload ERC-721 metadata
    const metadataUri = await this.pinataService.pinJson(
      {
        name:        title,
        description: description || '',
        image:       imageUri,
        attributes:  [],
      },
      `${title} — metadata`,
    );

    const gatewayImageUrl = this.pinataService.resolveGatewayUrl(imageUri);

    return { image_uri: imageUri, metadata_uri: metadataUri, gateway_image_url: gatewayImageUrl };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Auto-generate ticker từ title.
   * "Pale Architecture" → $PALARCH
   * "Genesis"           → $GENESI
   */
  private generateTicker(title: string): string {
    const words = title.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '$TOKEN';
    const raw =
      words.length >= 2
        ? (words[0].slice(0, 3) + words[1].slice(0, 3)).toUpperCase()
        : words[0].slice(0, 6).toUpperCase();
    return '$' + raw.replace(/[^A-Z]/g, '');
  }
}
