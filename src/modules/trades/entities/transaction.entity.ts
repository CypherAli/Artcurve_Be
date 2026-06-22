import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Artwork } from '../../artworks/entities/artwork.entity';

export enum TransactionType {
  BUY = 'BUY',
  SELL = 'SELL',
  MINT = 'MINT',
  GRADUATE = 'GRADUATE',
}

// Composite index theo ERD: idx_tx_history(artwork_id, timestamp) — phục vụ query lịch sử giao dịch
@Index('idx_tx_history', ['artwork_id', 'timestamp'])
@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // tx_hash là Idempotency Key — UNIQUE constraint ngăn ghi đúp dữ liệu từ blockchain event
  // Blockchain indexer có thể gửi lại event, tx_hash đảm bảo chỉ insert một lần
  @Index('idx_transactions_tx_hash', { unique: true })
  @Column({ type: 'varchar', length: 66 })
  tx_hash: string;

  @Index('idx_transactions_user_id')
  @Column({ type: 'uuid', name: 'user_id' })
  user_id: string;

  @Column({ type: 'uuid', name: 'artwork_id' })
  artwork_id: string;

  @Column({
    type: 'enum',
    enum: TransactionType,
    name: 'tx_type',
  })
  tx_type: TransactionType;

  // Tất cả giá trị tài chính dùng DECIMAL(18,8) — tuyệt đối không dùng float
  @Column({ type: 'decimal', precision: 18, scale: 8 })
  share_amount: string;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  eth_amount: string;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  price_per_share: string;

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  gas_fee: string;

  // bigint cho block_number — số block có thể vượt quá INTEGER range
  @Index('idx_tx_block_number')
  @Column({ type: 'bigint', nullable: true })
  block_number: string;

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  // ─── Relationships ────────────────────────────────────────────────────────

  @ManyToOne(() => User, (user) => user.transactions, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Artwork, (artwork) => artwork.transactions, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'artwork_id' })
  artwork: Artwork;
}
