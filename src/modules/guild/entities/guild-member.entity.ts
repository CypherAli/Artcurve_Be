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
import { Guild } from './guild.entity';

export enum GuildRole {
  OWNER = 'owner',
  MODERATOR = 'moderator',
  MEMBER = 'member',
}

@Index('idx_guild_member', ['guild_id', 'user_id'], { unique: true })
@Entity('guild_members')
export class GuildMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'guild_id' })
  guild_id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  user_id: string;

  @Column({ type: 'enum', enum: GuildRole, default: GuildRole.MEMBER })
  role: GuildRole;

  @CreateDateColumn({ type: 'timestamptz', name: 'joined_at' })
  joined_at: Date;

  // ─── Relationships ────────────────────────────────────────────────────────

  @ManyToOne(() => Guild, (g) => g.members, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'guild_id' })
  guild: Guild;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
