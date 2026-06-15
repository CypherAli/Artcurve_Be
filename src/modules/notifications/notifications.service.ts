import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotifType } from './entities/notification.entity';
import { EventsGateway } from '../gateway/events.gateway';

export interface CreateNotifDto {
  user_id:     string;
  type:        NotifType;
  title:       string;
  description?: string;
  metadata?:   Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
    @Optional()
    private readonly eventsGateway?: EventsGateway,
  ) {}

  // ── Tạo thông báo + push real-time via WebSocket ─────────────────────────
  async create(dto: CreateNotifDto): Promise<Notification> {
    const notif = this.repo.create({
      user_id:     dto.user_id,
      type:        dto.type,
      title:       dto.title,
      description: dto.description ?? null,
      metadata:    dto.metadata    ?? null,
    });
    const saved = await this.repo.save(notif);

    this.eventsGateway?.pushNotification(dto.user_id, {
      id:         saved.id,
      type:       saved.type,
      title:      saved.title,
      message:    saved.description ?? '',
      created_at: saved.created_at.toISOString(),
    });

    return saved;
  }

  // ── Lấy danh sách cho user (mới nhất trước, giới hạn 50) ─────────────────
  async findForUser(userId: string, limit = 50): Promise<Notification[]> {
    return this.repo.find({
      where:  { user_id: userId },
      order:  { created_at: 'DESC' },
      take:   limit,
    });
  }

  // ── Đếm unread ────────────────────────────────────────────────────────────
  async unreadCount(userId: string): Promise<number> {
    return this.repo.count({ where: { user_id: userId, is_read: false } });
  }

  // ── Mark all read ─────────────────────────────────────────────────────────
  async markAllRead(userId: string): Promise<void> {
    await this.repo.update({ user_id: userId, is_read: false }, { is_read: true });
  }

  // ── Mark single read ──────────────────────────────────────────────────────
  async markRead(id: string, userId: string): Promise<void> {
    await this.repo.update({ id, user_id: userId }, { is_read: true });
  }

  // ── Xoá tất cả ───────────────────────────────────────────────────────────
  async clearAll(userId: string): Promise<void> {
    await this.repo.delete({ user_id: userId });
  }

  // ── Xoá 1 ────────────────────────────────────────────────────────────────
  async deleteOne(id: string, userId: string): Promise<void> {
    await this.repo.delete({ id, user_id: userId });
  }
}
