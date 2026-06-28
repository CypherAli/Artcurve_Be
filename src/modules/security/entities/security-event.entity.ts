import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('security_events')
export class SecurityEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  event_type: string; // LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, BRUTE_FORCE_BLOCKED, SUSPICIOUS_ACTIVITY, TOKEN_REVOKED, RATE_LIMITED

  @Index()
  @Column({ type: 'varchar', length: 42, nullable: true })
  wallet_address: string | null;

  @Column({ type: 'varchar', length: 45 }) // IPv4 or IPv6
  ip_address: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  user_agent: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null; // extra context

  @Column({ type: 'varchar', length: 20, default: 'INFO' })
  severity: string; // INFO, WARNING, CRITICAL

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
