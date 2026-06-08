import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, Index,
} from 'typeorm';

export type NotifType =
  | 'trade'       // lệnh BUY/SELL đã khớp
  | 'price'       // artwork tăng/giảm giá đáng kể
  | 'follow'      // ai đó follow bạn
  | 'sale'        // milestone bán token
  | 'graduation'; // artwork graduate lên DEX

@Index('idx_notif_user_created', ['user_id', 'created_at'])
@Index('idx_notif_user_unread',  ['user_id', 'is_read'])
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 32 })
  type: NotifType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // Dữ liệu tuỳ theo loại: artwork_id, tx_hash, follower_wallet, v.v.
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  is_read: boolean;

  @CreateDateColumn()
  created_at: Date;
}
