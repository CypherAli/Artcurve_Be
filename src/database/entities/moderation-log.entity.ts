import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Artwork } from './artwork.entity';
import { User } from './user.entity';

export enum ModerationAction {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  FLAGGED = 'FLAGGED',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

@Entity('moderation_logs')
export class ModerationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_moderation_artwork_id')
  @Column({ type: 'uuid', name: 'artwork_id' })
  artwork_id: string;

  // Nullable vì AI auto-moderation không có admin_id
  @Column({ type: 'uuid', name: 'admin_id', nullable: true })
  admin_id: string;

  // DECIMAL(5,2) theo ERD — score từ 0.00 đến 100.00 (Google Vision NSFW score)
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  ai_confidence_score: string;

  @Column({ type: 'text', name: 'action_taken' })
  action_taken: string;

  @Column({ type: 'text', nullable: true })
  reason: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  // ─── Relationships ────────────────────────────────────────────────────────

  @ManyToOne(() => Artwork, (artwork) => artwork.moderation_logs, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'artwork_id' })
  artwork: Artwork;

  // Admin có thể null (AI tự động) — dùng nullable: true
  @ManyToOne(() => User, (user) => user.moderation_logs, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'admin_id' })
  admin: User;
}
