import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, Index,
} from 'typeorm';

@Index('idx_live_tip_room', ['room_name', 'created_at'])
@Entity('live_tips')
export class LiveTip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  room_name: string;

  @Column({ type: 'uuid' })
  from_user_id: string;

  @Column({ type: 'varchar', length: 64 })
  from_user_name: string;

  @Column({ type: 'uuid' })
  to_host_id: string;

  @Column({ type: 'varchar', length: 78 })
  amount_eth: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  message: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;
}
