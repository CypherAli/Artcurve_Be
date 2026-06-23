import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { Guild } from './guild.entity';

@Index('idx_guild_invite_code', ['code'], { unique: true })
@Index('idx_guild_invite_guild', ['guild_id'])
@Entity('guild_invites')
export class GuildInvite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'guild_id' })
  guild_id: string;

  @Column({ type: 'varchar', length: 16, unique: true })
  code: string;

  @Column({ type: 'uuid', name: 'created_by' })
  created_by: string;

  @Column({ type: 'int', default: 0 })
  uses: number;

  @Column({ type: 'int', nullable: true })
  max_uses: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  @ManyToOne(() => Guild, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'guild_id' })
  guild: Guild;
}
