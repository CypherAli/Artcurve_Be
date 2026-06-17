import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { GuildMember } from './guild-member.entity';
import { GuildMessage } from './guild-message.entity';

@Entity('guilds')
export class Guild {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 32 })
  focus: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creator_id: string;

  @Column({ type: 'int', default: 1 })
  member_count: number;

  @Column({ type: 'int', default: 1 })
  level: number;

  @Column({ type: 'int', default: 30, name: 'max_members' })
  max_members: number;

  // 'auto' = duyệt tự động · 'manual' = chủ guild duyệt tay
  @Column({ type: 'varchar', length: 10, default: 'auto' })
  acceptance: string;

  @Column({ type: 'varchar', length: 7, nullable: true })
  avatar_color: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at: Date;

  // ─── Relationships ────────────────────────────────────────────────────────

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'creator_id' })
  creator: User;

  @OneToMany(() => GuildMember, (m) => m.guild)
  members: GuildMember[];

  @OneToMany(() => GuildMessage, (m) => m.guild)
  messages: GuildMessage[];
}
