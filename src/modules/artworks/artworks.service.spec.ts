import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { ArtworksService } from './artworks.service';
import { Artwork, ArtworkStatus, CurveType } from './entities/artwork.entity';
import { Transaction } from '../trades/entities/transaction.entity';
import { PinataService } from './pinata.service';
import { RedisService } from '../../shared/redis/redis.service';

describe('ArtworksService', () => {
  let service: ArtworksService;
  let artworkRepo: jest.Mocked<Repository<Artwork>>;
  let dataSource: jest.Mocked<DataSource>;

  function makeQb(result: any, count = 1) {
    const qb: any = {};
    for (const m of [
      'leftJoin', 'addSelect', 'select', 'where', 'andWhere',
      'orderBy', 'skip', 'take', 'leftJoinAndSelect',
      'update', 'set',
    ]) {
      qb[m] = jest.fn().mockReturnValue(qb);
    }
    qb.execute = jest.fn().mockResolvedValue({});
    qb.getOne = jest.fn().mockResolvedValue(result);
    qb.getMany = jest.fn().mockResolvedValue(result ? [result] : []);
    qb.getManyAndCount = jest.fn().mockResolvedValue([result ? [result] : [], count]);
    return qb;
  }

  const mockArtwork: Partial<Artwork> = {
    id: 'art-1',
    title: 'Genesis',
    description: 'First artwork',
    status: ArtworkStatus.DRAFT,
    curve_type: CurveType.LINEAR,
    init_price: '0.001',
    target_cap: '100',
    current_price: '0.001',
    current_supply: '0',
    ticker: 'GEN',
    category: 'Digital',
    creator_id: 'user-1',
    view_count: 0,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(async () => {
    artworkRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
      count: jest.fn(),
      increment: jest.fn(),
    } as any;

    dataSource = {
      query: jest.fn(),
      getRepository: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        ArtworksService,
        { provide: getRepositoryToken(Artwork), useValue: artworkRepo },
        { provide: getRepositoryToken(Transaction), useValue: { find: jest.fn(), save: jest.fn() } },
        { provide: DataSource, useValue: dataSource },
        { provide: PinataService, useValue: { pinFile: jest.fn(), pinJson: jest.fn() } },
        { provide: RedisService, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
      ],
    }).compile();

    service = module.get(ArtworksService);
  });

  describe('getArtworkById', () => {
    it('should return artwork when found', async () => {
      const qb = makeQb(mockArtwork);
      artworkRepo.createQueryBuilder.mockReturnValue(qb as any);
      artworkRepo.increment.mockResolvedValue({} as any);

      const result = await service.getArtworkById('art-1');
      expect(result).toEqual(mockArtwork);
    });

    it('should throw NotFoundException when artwork not found', async () => {
      const qb = makeQb(null);
      artworkRepo.createQueryBuilder.mockReturnValue(qb as any);

      await expect(service.getArtworkById('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createDraftArtwork', () => {
    it('should create artwork in DRAFT status', async () => {
      const dto = {
        title: 'New Art',
        description: 'Test',
        category: 'Digital',
        curve_type: CurveType.LINEAR,
        init_price: 0.001,
        target_cap: 100,
      };
      artworkRepo.findOne.mockResolvedValue(null); // ticker not taken
      artworkRepo.create.mockReturnValue({ ...mockArtwork, title: dto.title } as Artwork);
      artworkRepo.save.mockResolvedValue({ ...mockArtwork, title: dto.title } as Artwork);

      const result = await service.createDraftArtwork('user-1', dto as any);
      expect(artworkRepo.create).toHaveBeenCalled();
      expect(artworkRepo.save).toHaveBeenCalled();
    });
  });

  describe('updateArtworkStatus', () => {
    it('should throw NotFoundException for non-existent artwork', async () => {
      artworkRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateArtworkStatus('user-1', 'bad', { status: ArtworkStatus.ACTIVE } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject invalid state transitions', async () => {
      artworkRepo.findOne.mockResolvedValue({
        ...mockArtwork,
        status: ArtworkStatus.DRAFT,
        creator_id: 'user-1',
      } as Artwork);

      await expect(
        service.updateArtworkStatus('user-1', 'art-1', { status: ArtworkStatus.GRADUATED } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('searchArtworks', () => {
    it('should search and return paginated results', async () => {
      const qb = makeQb(null, 0);
      artworkRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.searchArtworks({ q: 'genesis', page: 1, limit: 20 } as any);
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');
    });
  });
});
