import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Artwork } from './artwork.entity';

// Composite index theo ERD — query "portfolio của user X với artwork Y"
@Index('idx_user_portfolio', ['user_id', 'artwork_id'])
@Entity('portfolio_holdings')
export class PortfolioHolding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  user_id: string;

  @Column({ type: 'uuid', name: 'artwork_id' })
  artwork_id: string;

  // DECIMAL(18,8) cho share balance và giá mua trung bình
  @Column({ type: 'decimal', precision: 18, scale: 8, default: '0' })
  share_balance: string;

  @Column({ type: 'decimal', precision: 18, scale: 8, default: '0' })
  avg_buy_price: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at: Date;

  // ─── Relationships ────────────────────────────────────────────────────────

  @ManyToOne(() => User, (user) => user.portfolio_holdings, {
    nullable: false,
    onDelete: 'CASCADE', // Xóa user → xóa portfolio của họ
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Artwork, (artwork) => artwork.portfolio_holdings, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'artwork_id' })
  artwork: Artwork;
}
