import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Index('idx_live_room_name', ['room_name'], { unique: true })
@Index('idx_live_host',      ['host_id'])
@Index('idx_live_is_live',   ['is_live'])
@Entity('live_streams')
export class LiveStream {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128, unique: true })
  room_name: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 64, default: 'Painting' })
  category: string;

  /** wallet address hoặc user UUID của host */
  @Column({ type: 'varchar', length: 255 })
  host_id: string;

  @Column({ type: 'varchar', length: 128 })
  host_name: string;

  @Column({ type: 'int', default: 0 })
  viewer_count: number;

  @Column({ type: 'boolean', default: true })
  is_live: boolean;

  /** ticker artwork liên quan (tuỳ chọn) */
  @Column({ type: 'varchar', length: 32, nullable: true })
  artwork_ticker: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  ended_at: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
