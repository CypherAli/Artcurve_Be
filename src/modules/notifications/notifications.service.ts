import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotifType } from './entities/notification.entity';

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
  ) {}

  // ── Tạo thông báo (gọi nội bộ từ các consumer/service) ───────────────────
  async create(dto: CreateNotifDto): Promise<Notification> {
    const notif = this.repo.create({
      user_id:     dto.user_id,
      type:        dto.type,
      title:       dto.title,
      description: dto.description ?? null,
      metadata:    dto.metadata    ?? null,
    });
    return this.repo.save(notif);
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
