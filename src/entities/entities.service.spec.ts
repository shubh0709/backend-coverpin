import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntitiesService } from './entities.service';
import { ComplianceEntity, EntityStatus, EntityType } from './entity.entity';
import { Filing, FilingStatus, FilingType } from './filing.entity';

type MockRepo<T = any> = Partial<Record<keyof T, jest.Mock>> & Record<string, jest.Mock>;

const createMockRepo = (): MockRepo => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((dto) => dto),
  save: jest.fn((entity) => Promise.resolve({ id: 'generated-id', ...entity })),
  delete: jest.fn(),
});

describe('EntitiesService', () => {
  let service: EntitiesService;
  let entitiesRepo: MockRepo;
  let filingsRepo: MockRepo;

  beforeEach(async () => {
    entitiesRepo = createMockRepo();
    filingsRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntitiesService,
        { provide: getRepositoryToken(ComplianceEntity), useValue: entitiesRepo },
        { provide: getRepositoryToken(Filing), useValue: filingsRepo },
      ],
    }).compile();

    service = module.get(EntitiesService);
  });

  describe('create', () => {
    it('rejects a duplicate entity in the same jurisdiction', async () => {
      entitiesRepo.findOne.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({
          name: 'Acme LLC',
          entityType: EntityType.LLC,
          jurisdiction: 'US-DE',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a new entity when none exists', async () => {
      entitiesRepo.findOne.mockResolvedValue(null);

      const result = await service.create({
        name: 'Acme LLC',
        entityType: EntityType.LLC,
        jurisdiction: 'US-DE',
      });

      expect(entitiesRepo.save).toHaveBeenCalled();
      expect(result.name).toBe('Acme LLC');
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when entity is missing', async () => {
      entitiesRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('transitionFilingStatus', () => {
    const baseFiling = {
      id: 'filing-1',
      entityId: 'entity-1',
      filingType: FilingType.ANNUAL_REPORT,
      status: FilingStatus.PENDING,
    };

    it('allows PENDING -> AI_PROCESSING', async () => {
      filingsRepo.findOne.mockResolvedValue({ ...baseFiling });

      const result = await service.transitionFilingStatus(
        'entity-1',
        'filing-1',
        FilingStatus.AI_PROCESSING,
      );

      expect(result.status).toBe(FilingStatus.AI_PROCESSING);
    });

    it('rejects skipping straight from PENDING to CONFIRMED', async () => {
      filingsRepo.findOne.mockResolvedValue({ ...baseFiling });

      await expect(
        service.transitionFilingStatus('entity-1', 'filing-1', FilingStatus.CONFIRMED),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects any transition out of the terminal CONFIRMED state', async () => {
      filingsRepo.findOne.mockResolvedValue({ ...baseFiling, status: FilingStatus.CONFIRMED });

      await expect(
        service.transitionFilingStatus('entity-1', 'filing-1', FilingStatus.PENDING),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException for a filing that does not belong to the entity', async () => {
      filingsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.transitionFilingStatus('entity-1', 'filing-1', FilingStatus.AI_PROCESSING),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
