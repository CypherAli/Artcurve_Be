import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { SocialService } from './social.service';
import { Follower } from './entities/follower.entity';
import { SocialInteraction } from './entities/social-interaction.entity';
import { NotificationsService } from '../notifications/notifications.service';

describe('SocialService', () => {
  let service: SocialService;
  let followerRepo: jest.Mocked<Repository<Follower>>;
  let interactionRepo: jest.Mocked<Repository<SocialInteraction>>;
  let notifSvc: jest.Mocked<NotificationsService>;
  let ds: jest.Mocked<DataSource>;

  beforeEach(async () => {
    followerRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    } as any;

    interactionRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as any;

    notifSvc = {
      create: jest.fn().mockResolvedValue({}),
    } as any;

    ds = {
      query: jest.fn().mockResolvedValue([{ username: 'testuser', wallet_address: '0x123' }]),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        SocialService,
        { provide: getRepositoryToken(Follower), useValue: followerRepo },
        { provide: getRepositoryToken(SocialInteraction), useValue: interactionRepo },
        { provide: NotificationsService, useValue: notifSvc },
        { provide: DataSource, useValue: ds },
      ],
    }).compile();

    service = module.get(SocialService);
  });

  // ── Follow ──────────────────────────────────────────────────────

  describe('follow', () => {
    it('should create follow relationship and notify', async () => {
      followerRepo.findOne.mockResolvedValue(null);
      followerRepo.save.mockResolvedValue({} as any);

      await service.follow('user-a', 'user-b');

      expect(followerRepo.save).toHaveBeenCalledWith({
        follower_id: 'user-a',
        following_id: 'user-b',
      });
      expect(notifSvc.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-b',
          type: 'follow',
        }),
      );
    });

    it('should throw ConflictException when self-following', async () => {
      await expect(service.follow('user-a', 'user-a')).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when already following', async () => {
      followerRepo.findOne.mockResolvedValue({} as any);
      await expect(service.follow('user-a', 'user-b')).rejects.toThrow(ConflictException);
    });
  });

  describe('unfollow', () => {
    it('should remove follow relationship', async () => {
      followerRepo.delete.mockResolvedValue({ affected: 1 } as any);
      await service.unfollow('user-a', 'user-b');
      expect(followerRepo.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException when not following', async () => {
      followerRepo.delete.mockResolvedValue({ affected: 0 } as any);
      await expect(service.unfollow('user-a', 'user-b')).rejects.toThrow(NotFoundException);
    });
  });

  describe('isFollowing', () => {
    it('should return true when following', async () => {
      followerRepo.findOne.mockResolvedValue({} as any);
      expect(await service.isFollowing('a', 'b')).toBe(true);
    });

    it('should return false when not following', async () => {
      followerRepo.findOne.mockResolvedValue(null);
      expect(await service.isFollowing('a', 'b')).toBe(false);
    });
  });

  // ── Likes ───────────────────────────────────────────────────────

  describe('likeArtwork', () => {
    function mockInsertQb(rawResult: any[]) {
      const qb: any = {};
      qb.insert = jest.fn().mockReturnValue(qb);
      qb.values = jest.fn().mockReturnValue(qb);
      qb.orIgnore = jest.fn().mockReturnValue(qb);
      qb.execute = jest.fn().mockResolvedValue({ raw: rawResult });
      interactionRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    }

    it('should create LIKE interaction', async () => {
      mockInsertQb([{ id: '1' }]);
      await service.likeArtwork('user-1', 'art-1');
      expect(interactionRepo.createQueryBuilder).toHaveBeenCalled();
    });

    it('should throw ConflictException when already liked', async () => {
      mockInsertQb([]);
      await expect(service.likeArtwork('user-1', 'art-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('getLikeCount', () => {
    it('should return count', async () => {
      interactionRepo.count.mockResolvedValue(42);
      const result = await service.getLikeCount('art-1');
      expect(result).toEqual({ count: 42 });
    });
  });

  // ── Comments ────────────────────────────────────────────────────

  describe('createComment', () => {
    function mockNoDuplicate() {
      const qb: any = {};
      qb.where = jest.fn().mockReturnValue(qb);
      qb.andWhere = jest.fn().mockReturnValue(qb);
      qb.getOne = jest.fn().mockResolvedValue(null);
      interactionRepo.createQueryBuilder.mockReturnValue(qb);
    }

    it('should create COMMENT with rating', async () => {
      mockNoDuplicate();
      const comment = { id: 'c1', content: 'Great art', rating: 5 };
      interactionRepo.create.mockReturnValue(comment as any);
      interactionRepo.save.mockResolvedValue(comment as any);

      const result = await service.createComment('user-1', 'art-1', 'Great art', 5);
      expect(result.content).toBe('Great art');
      expect(interactionRepo.create).toHaveBeenCalledWith({
        user_id: 'user-1',
        artwork_id: 'art-1',
        interaction_type: 'COMMENT',
        content: 'Great art',
        rating: 5,
      });
    });

    it('should create COMMENT without rating', async () => {
      mockNoDuplicate();
      interactionRepo.create.mockReturnValue({ content: 'Nice' } as any);
      interactionRepo.save.mockResolvedValue({ content: 'Nice' } as any);

      await service.createComment('user-1', 'art-1', 'Nice');
      expect(interactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ rating: null }),
      );
    });
  });

  describe('deleteComment', () => {
    it('should delete own comment', async () => {
      interactionRepo.findOne.mockResolvedValue({ id: 'c1', user_id: 'user-1' } as any);
      interactionRepo.remove.mockResolvedValue({} as any);

      await service.deleteComment('user-1', 'c1');
      expect(interactionRepo.remove).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent comment', async () => {
      interactionRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteComment('user-1', 'bad')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when deleting others comment', async () => {
      interactionRepo.findOne.mockResolvedValue({ id: 'c1', user_id: 'user-2' } as any);
      await expect(service.deleteComment('user-1', 'c1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ── Stats ───────────────────────────────────────────────────────

  describe('getArtworkStats', () => {
    const mockStatsQb = (raw: { like_count: string; comment_count: string; avg_rating: string | null }) => {
      const qb: any = {};
      qb.select = jest.fn().mockReturnValue(qb);
      qb.addSelect = jest.fn().mockReturnValue(qb);
      qb.where = jest.fn().mockReturnValue(qb);
      qb.getRawOne = jest.fn().mockResolvedValue(raw);
      interactionRepo.createQueryBuilder.mockReturnValue(qb);
    };

    it('should calculate stats correctly', async () => {
      mockStatsQb({ like_count: '10', comment_count: '3', avg_rating: '4.5' });

      const stats = await service.getArtworkStats('art-1');
      expect(stats.like_count).toBe(10);
      expect(stats.comment_count).toBe(3);
      expect(stats.avg_rating).toBe(4.5);
    });

    it('should return null avg_rating when no ratings', async () => {
      mockStatsQb({ like_count: '0', comment_count: '0', avg_rating: null });

      const stats = await service.getArtworkStats('art-1');
      expect(stats.avg_rating).toBeNull();
    });
  });
});
