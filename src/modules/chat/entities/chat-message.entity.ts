import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, Index,
} from 'typeorm';

export type MessageSender = 'user' | 'ai' | 'staff';

@Index('idx_chat_msg_session', ['session_id', 'created_at'])
@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  session_id: string;

  @Column({ type: 'varchar', length: 8 })
  sender: MessageSender;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at: Date;
}
