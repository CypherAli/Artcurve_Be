import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Guild } from './guild.entity';

@Index('idx_guild_message_guild', ['guild_id'])
@Entity('guild_messages')
export class GuildMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'guild_id' })
  guild_id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  user_id: string;

  @Column({ type: 'varchar', length: 64 })
  user_name: string;

  @Column({ type: 'varchar', length: 500 })
  content: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  // ─── Relationships ────────────────────────────────────────────────────────

  @ManyToOne(() => Guild, (g) => g.messages, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'guild_id' })
  guild: Guild;
}
