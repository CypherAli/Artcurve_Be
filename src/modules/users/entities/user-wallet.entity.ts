import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

/**
 * UserWallet — ví đã liên kết với tài khoản (multi-wallet).
 *
 * - 1 user có nhiều ví; 1 ví chỉ thuộc đúng 1 user (UNIQUE wallet_address).
 * - Ví primary là ví định danh gốc (trùng users.wallet_address).
 * - Liên kết ví mới yêu cầu ký SIWE bằng chính ví đó (proof of ownership).
 */
@Entity('user_wallets')
export class UserWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_user_wallets_user_id')
  @Column({ type: 'uuid', name: 'user_id' })
  user_id: string;

  @Index('idx_user_wallets_address', { unique: true })
  @Column({ type: 'varchar', length: 42 })
  wallet_address: string;

  /** Nhãn tuỳ chọn user tự đặt — "Ledger chính", "Ví hot"... */
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  label: string | null;

  @Column({ type: 'boolean', default: false })
  is_primary: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
