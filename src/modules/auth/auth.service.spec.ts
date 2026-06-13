import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { RedisService } from '../../shared/redis/redis.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: jest.Mocked<JwtService>;
  let redisService: jest.Mocked<RedisService>;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('mock.jwt.token'),
      verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-id', jti: 'jti-1', wallet: '0x123' }),
      verify: jest.fn().mockReturnValue({ sub: 'user-id', jti: 'jti-1', wallet: '0x123', exp: Math.floor(Date.now() / 1000) + 3600 }),
    } as any;

    const configService = {
      get: jest.fn((key: string, defaultVal?: any) => {
        const map: Record<string, any> = {
          JWT_SECRET: 'test-secret-key-32-chars-minimum!!',
          JWT_EXPIRES_IN: '7d',
          FRONTEND_URL: 'http://localhost:3000',
          BACKEND_URL: 'http://localhost:3001',
          APP_DOMAIN: 'artcurve.io',
          APP_URI: 'https://artcurve.io',
          CHAIN_ID: 84532,
        };
        return map[key] ?? defaultVal;
      }),
      getOrThrow: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret-key-32-chars-minimum!!';
        throw new Error(`Missing ${key}`);
      }),
    };

    redisService = {
      getNonce: jest.fn(),
      setNonce: jest.fn().mockResolvedValue(undefined),
      consumeNonce: jest.fn(),
      blacklistJwt: jest.fn().mockResolvedValue(undefined),
      isJwtBlacklisted: jest.fn(),
      setTemp: jest.fn(),
      getTemp: jest.fn(),
      deleteTemp: jest.fn(),
      del: jest.fn(),
    } as any;

    dataSource = {
      query: jest.fn().mockResolvedValue([]),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: RedisService, useValue: redisService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('getNonce', () => {
    const wallet = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // vitalik.eth checksum

    it('should generate nonce and store in Redis', async () => {
      dataSource.query.mockResolvedValue([]); // upsert user
      const result = await service.getNonce(wallet);

      expect(result).toHaveProperty('nonce');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('siweMessage');
      expect(typeof result.nonce).toBe('string');
      expect(result.message).toContain('artcurve.io');
      expect(redisService.setNonce).toHaveBeenCalled();
    });

    it('should throw for invalid wallet address', async () => {
      await expect(service.getNonce('invalid')).rejects.toThrow();
    });

    it('should throw for empty wallet', async () => {
      await expect(service.getNonce('')).rejects.toThrow();
    });
  });

  describe('verifySignatureAndIssueJwt', () => {
    it('should throw when nonce expired/not found', async () => {
      redisService.consumeNonce.mockResolvedValue(null);

      await expect(
        service.verifySignatureAndIssueJwt(
          '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
          '0xfakesig',
          'fake-message',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should blacklist JWT jti in Redis', async () => {
      await service.logout('mock.jwt.token');

      expect(jwtService.verify).toHaveBeenCalled();
      expect(redisService.blacklistJwt).toHaveBeenCalledWith('jti-1', expect.any(Number));
    });

    it('should throw for empty token', async () => {
      await expect(service.logout('')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw for invalid/tampered token', async () => {
      jwtService.verify.mockImplementation(() => { throw new Error('invalid signature'); });
      await expect(service.logout('bad-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateJwtPayload', () => {
    it('should return user from DB', async () => {
      const mockUser = { id: 'user-1', wallet_address: '0x123', role: 'user', is_verified: false };
      dataSource.query.mockResolvedValue([mockUser]);

      const result = await service.validateJwtPayload({
        sub: 'user-1', jti: 'jti-1', wallet: '0x123',
      } as any);
      expect(result).toEqual(mockUser);
    });

    it('should throw when user not found in DB', async () => {
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.validateJwtPayload({ sub: 'deleted-user', jti: 'jti-2', wallet: '0x000' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
