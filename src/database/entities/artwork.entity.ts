import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Transaction } from './transaction.entity';
import { PortfolioHolding } from './portfolio-holding.entity';
import { SocialInteraction } from './social-interaction.entity';
import { ModerationLog } from './moderation-log.entity';

// State machine lifecycle: DRAFT → AI_MODERATING → ACTIVE → TARGET_REACHED → GRADUATED
export enum ArtworkStatus {
  DRAFT           = 'DRAFT',
  AI_MODERATING   = 'AI_MODERATING',
  ACTIVE          = 'ACTIVE',
  TARGET_REACHED  = 'TARGET_REACHED',
  GRADUATED       = 'GRADUATED',
}

export enum CurveType {
  LINEAR      = 'linear',
  QUADRATIC   = 'quadratic',
  EXPONENTIAL = 'exponential',
}

export const ARTWORK_CATEGORIES = [
  'Painting',
  'Drawing',
  'Digital',
  'Photography',
  'Sculpture',
  'Mixed Media',
  'Generative',
] as const;

export type ArtworkCategory = typeof ARTWORK_CATEGORIES[number];

@Entity('artworks')
export class Artwork {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // FK — TypeORM không tự tạo index cho FK, cần khai báo riêng
  @Index('idx_artworks_creator_id')
  @Column({ type: 'uuid', name: 'creator_id' })
  creator_id: string;

  // contract_address nullable — chưa có khi DRAFT, set khi ACTIVE
  @Index('idx_artworks_contract_address', { unique: true })
  @Column({ type: 'varchar', length: 42, nullable: true, default: null })
  contract_address: string | null;

  // ── Core content ─────────────────────────────────────────────────────────

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  ipfs_metadata_uri: string | null;

  // ── Token metadata (set at DRAFT creation, frozen after ACTIVE) ───────────

  /**
   * Token ticker — e.g. "$PALE", "$BLOOM"
   * Unique constraint ngăn duplicate ticker trong toàn platform.
   * Format: $ + 1-6 uppercase letters (validated in DTO).
   */
  @Index('idx_artworks_ticker', { unique: true })
  @Column({ type: 'varchar', length: 10, nullable: true, default: null })
  ticker: string | null;

  /**
   * Artwork category — dùng cho filtering trên marketplace.
   * Values: Painting | Drawing | Digital | Photography | Sculpture | Mixed Media | Generative
   */
  @Index('idx_artworks_category')
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  category: string | null;

  /**
   * Creator royalty (%) — được trả mỗi lần token giao dịch thứ cấp.
   * DECIMAL(5,2): 0.00 - 10.00%
   */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: '5.00' })
  royalty_pct: string;

  /**
   * Bonding curve type — quyết định hình dạng AMM price curve.
   * linear | quadratic | exponential
   */
  @Column({
    type: 'enum',
    enum: CurveType,
    default: CurveType.QUADRATIC,
  })
  curve_type: CurveType;

  /**
   * Initial price per token (ETH).
   * Được đặt tại thời điểm tạo DRAFT, dùng để seed AMM.
   * DECIMAL(18,8) — không dùng float.
   */
  @Column({ type: 'decimal', precision: 18, scale: 8, default: '0.00100000' })
  init_price: string;

  // ── State machine ─────────────────────────────────────────────────────────

  @Index('idx_artworks_status')
  @Column({
    type: 'enum',
    enum: ArtworkStatus,
    default: ArtworkStatus.DRAFT,
  })
  status: ArtworkStatus;

  // ── Bonding curve live stats ───────────────────────────────────────────────
  // Cập nhật bởi BlockchainEventConsumer — KHÔNG update trực tiếp qua REST

  /** Total token supply đã bán ra qua AMM */
  @Column({ type: 'decimal', precision: 18, scale: 8, default: '0' })
  current_supply: string;

  /** Giá token hiện tại theo bonding curve (ETH/token) */
  @Column({ type: 'decimal', precision: 18, scale: 8, default: '0' })
  current_price: string;

  /**
   * Target cap — ngưỡng supply khi đạt được sẽ trigger graduation lên DEX.
   * Phải > 0, validated trong DTO.
   */
  @Column({ type: 'decimal', precision: 18, scale: 8, default: '0' })
  target_cap: string;

  // ── Engagement ────────────────────────────────────────────────────────────

  @Column({ type: 'integer', default: 0 })
  view_count: number;

  // ── Timestamps ────────────────────────────────────────────────────────────

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at: Date;

  // ── Relationships ─────────────────────────────────────────────────────────

  @ManyToOne(() => User, (user) => user.artworks, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'creator_id' })
  creator: User;

  @OneToMany(() => Transaction, (tx) => tx.artwork)
  transactions: Transaction[];

  @OneToMany(() => PortfolioHolding, (ph) => ph.artwork)
  portfolio_holdings: PortfolioHolding[];

  @OneToMany(() => SocialInteraction, (si) => si.artwork)
  social_interactions: SocialInteraction[];

  @OneToMany(() => ModerationLog, (ml) => ml.artwork)
  moderation_logs: ModerationLog[];
}
