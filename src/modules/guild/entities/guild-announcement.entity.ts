import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { Guild } from './guild.entity';

@Index('idx_guild_announcement_guild', ['guild_id'])
@Entity('guild_announcements')
export class GuildAnnouncement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'guild_id' })
  guild_id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  user_id: string;

  @Column({ type: 'varchar', length: 64 })
  user_name: string;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  @Column({ type: 'varchar', length: 1000 })
  content: string;

  @Column({ type: 'boolean', default: false })
  is_pinned: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at: Date;

  @ManyToOne(() => Guild, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'guild_id' })
  guild: Guild;
}
