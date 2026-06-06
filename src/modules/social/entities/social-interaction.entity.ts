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

export enum InteractionType {
  LIKE = 'LIKE',
  COMMENT = 'COMMENT',
  SHARE = 'SHARE',
  BOOKMARK = 'BOOKMARK',
}

@Entity('social_interactions')
export class SocialInteraction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_social_user_id')
  @Column({ type: 'uuid', name: 'user_id' })
  user_id: string;

  @Index('idx_social_artwork_id')
  @Column({ type: 'uuid', name: 'artwork_id' })
  artwork_id: string;

  @Column({ type: 'text', name: 'interaction_type' })
  interaction_type: string;

  // Nullable vì LIKE không cần content, chỉ COMMENT mới có
  @Column({ type: 'text', nullable: true })
  content: string;

  // Rating 1-5 sao — chỉ có ở COMMENT, NULL với LIKE/SHARE/BOOKMARK
  @Column({ type: 'smallint', nullable: true })
  rating: number | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  // ─── Relationships ────────────────────────────────────────────────────────

  @ManyToOne(() => User, (user) => user.social_interactions, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Artwork, (artwork) => artwork.social_interactions, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'artwork_id' })
  artwork: Artwork;
}
