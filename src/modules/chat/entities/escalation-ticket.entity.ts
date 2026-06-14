import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, Index,
} from 'typeorm';

export type TicketStatus   = 'open' | 'in_progress' | 'resolved';
export type TicketPriority = 'low' | 'medium' | 'high';

@Index('idx_escalation_session', ['session_id'])
@Index('idx_escalation_status', ['status'])
@Entity('escalation_tickets')
export class EscalationTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  session_id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: TicketStatus;

  @Column({ type: 'varchar', length: 8, default: 'medium' })
  priority: TicketPriority;

  @Column({ type: 'text' })
  summary: string;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolved_at: Date | null;
}
