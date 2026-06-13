import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserWallet } from './entities/user-wallet.entity';
import { RedisService } from '../../shared/redis/redis.service';

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: jest.Mocked<Repository<User>>;
  let walletRepo: jest.Mocked<Repository<UserWallet>>;

  const mockUser: Partial<User> = {
    id: 'uuid-1',
    wallet_address: '0xabcd1234abcd1234abcd1234abcd1234abcd1234',
    username: 'testuser',
    email: 'test@example.com',
    bio: 'hello',
    avatar_url: null,
    role: 'user',
    is_verified: false,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as any;

    walletRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserWallet), useValue: walletRepo },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test') } },
        { provide: RedisService, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn(), getdel: jest.fn() } },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('getProfile', () => {
    it('should return user when found', async () => {
      userRepo.findOne.mockResolvedValue(mockUser as User);
      const result = await service.getProfile('uuid-1');
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException when not found', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.getProfile('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('should update user profile fields', async () => {
      userRepo.findOne.mockResolvedValue(mockUser as User);
      userRepo.save.mockResolvedValue({ ...mockUser, username: 'newname' } as User);

      const result = await service.updateProfile('uuid-1', { username: 'newname' } as any);
      expect(result.username).toBe('newname');
    });

    it('should throw NotFoundException for invalid user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateProfile('bad-id', { username: 'x' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listWallets', () => {
    it('should return wallets for user', async () => {
      const wallets = [{ id: 'w1', wallet_address: '0x1', is_primary: true }];
      walletRepo.find.mockResolvedValue(wallets as any);
      const result = await service.listWallets('uuid-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('getPublicProfile', () => {
    it('should return public profile by wallet address', async () => {
      userRepo.findOne.mockResolvedValue(mockUser as User);
      const result = await service.getPublicProfile('0xabcd1234');
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException for unknown wallet', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.getPublicProfile('0xnonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getTopCreators', () => {
    it('should return top creators list', async () => {
      const qb = {
        leftJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([mockUser]),
        getMany: jest.fn().mockResolvedValue([mockUser]),
        select: jest.fn().mockReturnThis(),
      };
      userRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.getTopCreators(5);
      expect(result).toHaveLength(1);
    });
  });
});
