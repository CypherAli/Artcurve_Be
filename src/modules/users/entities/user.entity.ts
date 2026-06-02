import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Artwork } from '../../artworks/entities/artwork.entity';
import { Transaction } from '../../trades/entities/transaction.entity';
import { PortfolioHolding } from '../../portfolio/entities/portfolio-holding.entity';
import { Follower } from '../../social/entities/follower.entity';
import { SocialInteraction } from '../../social/entities/social-interaction.entity';
import { ModerationLog } from '../../artworks/entities/moderation-log.entity';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  MODERATOR = 'moderator',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // wallet_address là định danh chính — dùng VARCHAR(42) vì ETH address luôn cố định 42 ký tự
  @Index('idx_users_wallet_address', { unique: true })
  @Column({ type: 'varchar', length: 42 })
  wallet_address: string;

  // nonce được lưu trong Redis (TTL 5 phút) — không cần cột DB
  // @Column({ type: 'text', nullable: true })
  // nonce: string;

  @Column({ type: 'text', nullable: true })
  username: string;

  @Column({ type: 'text', nullable: true })
  email: string;

  @Column({ type: 'text', nullable: true })
  bio: string;

  @Column({ type: 'text', nullable: true })
  avatar_url: string;

  @Column({ type: 'text', nullable: true })
  twitter_handle: string;

  @Column({ type: 'boolean', default: false, nullable: false })
  is_verified: boolean;

  @Column({ type: 'text', default: UserRole.USER, nullable: false })
  role: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at: Date;

  // ─── Relationships ────────────────────────────────────────────────────────

  @OneToMany(() => Artwork, (artwork) => artwork.creator)
  artworks: Artwork[];

  @OneToMany(() => Transaction, (tx) => tx.user)
  transactions: Transaction[];

  @OneToMany(() => PortfolioHolding, (ph) => ph.user)
  portfolio_holdings: PortfolioHolding[];

  // Những người mà user này đang follow
  @OneToMany(() => Follower, (f) => f.follower)
  following: Follower[];

  // Những người đang follow user này
  @OneToMany(() => Follower, (f) => f.following_user)
  followers: Follower[];

  @OneToMany(() => SocialInteraction, (si) => si.user)
  social_interactions: SocialInteraction[];

  // Admin logs (khi admin_id = user.id trong moderation_logs)
  @OneToMany(() => ModerationLog, (ml) => ml.admin)
  moderation_logs: ModerationLog[];
}
