import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export type ChatSessionStatus = 'active' | 'escalated' | 'closed';

@Index('idx_chat_session_user', ['user_id'])
@Entity('chat_sessions')
export class ChatSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: ChatSessionStatus;

  @Column({ type: 'text', nullable: true })
  escalation_reason: string | null;

  @Column({ type: 'uuid', nullable: true })
  assigned_staff_id: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
