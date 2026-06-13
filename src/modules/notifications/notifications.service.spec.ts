import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationsService } from './notifications.service';
import { Notification } from './entities/notification.entity';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let repo: jest.Mocked<Repository<Notification>>;

  const mockNotif: Partial<Notification> = {
    id: 'notif-1',
    user_id: 'user-1',
    type: 'trade',
    title: 'Trade executed',
    description: 'Bought 100 shares',
    metadata: { artwork_id: 'art-1' },
    is_read: false,
    created_at: new Date(),
  };

  beforeEach(async () => {
    repo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(Notification), useValue: repo },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('create', () => {
    it('should create and save notification', async () => {
      repo.create.mockReturnValue(mockNotif as Notification);
      repo.save.mockResolvedValue(mockNotif as Notification);

      const result = await service.create({
        user_id: 'user-1',
        type: 'trade',
        title: 'Trade executed',
        description: 'Bought 100 shares',
        metadata: { artwork_id: 'art-1' },
      });

      expect(result.title).toBe('Trade executed');
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-1', type: 'trade' }),
      );
    });

    it('should handle optional fields as null', async () => {
      repo.create.mockReturnValue({ ...mockNotif, description: null, metadata: null } as Notification);
      repo.save.mockResolvedValue({ ...mockNotif, description: null, metadata: null } as Notification);

      await service.create({ user_id: 'user-1', type: 'follow', title: 'New follower' });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: null, metadata: null }),
      );
    });
  });

  describe('findForUser', () => {
    it('should return notifications ordered by created_at DESC', async () => {
      repo.find.mockResolvedValue([mockNotif as Notification]);

      const result = await service.findForUser('user-1');
      expect(result).toHaveLength(1);
      expect(repo.find).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        order: { created_at: 'DESC' },
        take: 50,
      });
    });

    it('should respect custom limit', async () => {
      repo.find.mockResolvedValue([]);
      await service.findForUser('user-1', 10);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  describe('unreadCount', () => {
    it('should return count of unread notifications', async () => {
      repo.count.mockResolvedValue(5);
      const count = await service.unreadCount('user-1');
      expect(count).toBe(5);
      expect(repo.count).toHaveBeenCalledWith({
        where: { user_id: 'user-1', is_read: false },
      });
    });

    it('should return 0 when all read', async () => {
      repo.count.mockResolvedValue(0);
      expect(await service.unreadCount('user-1')).toBe(0);
    });
  });

  describe('markAllRead', () => {
    it('should update all unread to read', async () => {
      repo.update.mockResolvedValue({ affected: 3 } as any);
      await service.markAllRead('user-1');
      expect(repo.update).toHaveBeenCalledWith(
        { user_id: 'user-1', is_read: false },
        { is_read: true },
      );
    });
  });

  describe('markRead', () => {
    it('should mark single notification as read', async () => {
      repo.update.mockResolvedValue({ affected: 1 } as any);
      await service.markRead('notif-1', 'user-1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'notif-1', user_id: 'user-1' },
        { is_read: true },
      );
    });
  });

  describe('clearAll', () => {
    it('should delete all notifications for user', async () => {
      repo.delete.mockResolvedValue({ affected: 10 } as any);
      await service.clearAll('user-1');
      expect(repo.delete).toHaveBeenCalledWith({ user_id: 'user-1' });
    });
  });

  describe('deleteOne', () => {
    it('should delete single notification scoped to user', async () => {
      repo.delete.mockResolvedValue({ affected: 1 } as any);
      await service.deleteOne('notif-1', 'user-1');
      expect(repo.delete).toHaveBeenCalledWith({ id: 'notif-1', user_id: 'user-1' });
    });
  });
});
