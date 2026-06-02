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

// Unique constraint theo ERD: idx_follow(follower_id, following_id) — ngăn follow đúp
@Index('idx_follow', ['follower_id', 'following_id'], { unique: true })
@Entity('followers')
export class Follower {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'follower_id' })
  follower_id: string;

  @Column({ type: 'uuid', name: 'following_id' })
  following_id: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  // ─── Relationships ────────────────────────────────────────────────────────

  // Người đang follow (người thực hiện hành động follow)
  @ManyToOne(() => User, (user) => user.following, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'follower_id' })
  follower: User;

  // Người được follow
  @ManyToOne(() => User, (user) => user.followers, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'following_id' })
  following_user: User;
}
