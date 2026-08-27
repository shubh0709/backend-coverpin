import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComplianceEntity } from './entity.entity';
import { Filing, FilingStatus } from './filing.entity';
import { CreateEntityDto } from './dto/create-entity.dto';
import { UpdateEntityDto } from './dto/update-entity.dto';
import { CreateFilingDto } from './dto/create-filing.dto';

/** Forward-only filing lifecycle. No skipping stages, no going backward. */
const FILING_TRANSITIONS: Record<FilingStatus, FilingStatus[]> = {
  [FilingStatus.PENDING]: [FilingStatus.AI_PROCESSING],
  [FilingStatus.AI_PROCESSING]: [FilingStatus.FILED, FilingStatus.PENDING],
  [FilingStatus.FILED]: [FilingStatus.CONFIRMED],
  [FilingStatus.CONFIRMED]: [],
};

@Injectable()
export class EntitiesService {
  constructor(
    @InjectRepository(ComplianceEntity)
    private readonly entitiesRepo: Repository<ComplianceEntity>,
    @InjectRepository(Filing)
    private readonly filingsRepo: Repository<Filing>,
  ) {}

  async create(dto: CreateEntityDto): Promise<ComplianceEntity> {
    const existing = await this.entitiesRepo.findOne({
      where: { name: dto.name, jurisdiction: dto.jurisdiction },
    });
    if (existing) {
      throw new ConflictException(
        `An entity named "${dto.name}" already exists in jurisdiction ${dto.jurisdiction}`,
      );
    }
    const entity = this.entitiesRepo.create(dto);
    return this.entitiesRepo.save(entity);
  }

  async findAll(): Promise<ComplianceEntity[]> {
    return this.entitiesRepo.find({
      relations: { filings: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<ComplianceEntity> {
    const entity = await this.entitiesRepo.findOne({
      where: { id },
      relations: { filings: true },
    });
    if (!entity) {
      throw new NotFoundException(`Entity ${id} not found`);
    }
    return entity;
  }

  async update(id: string, dto: UpdateEntityDto): Promise<ComplianceEntity> {
    const entity = await this.findOne(id);
    Object.assign(entity, dto);
    return this.entitiesRepo.save(entity);
  }

  async remove(id: string): Promise<void> {
    const result = await this.entitiesRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Entity ${id} not found`);
    }
  }

  async saveComplianceCheck(
    id: string,
    result: Record<string, unknown>,
  ): Promise<ComplianceEntity> {
    const entity = await this.findOne(id);
    entity.lastComplianceCheck = result;
    entity.lastCheckedAt = new Date();
    return this.entitiesRepo.save(entity);
  }

  async addFiling(entityId: string, dto: CreateFilingDto): Promise<Filing> {
    await this.findOne(entityId);
    const filing = this.filingsRepo.create({ ...dto, entityId });
    return this.filingsRepo.save(filing);
  }

  async listFilings(entityId: string): Promise<Filing[]> {
    await this.findOne(entityId);
    return this.filingsRepo.find({
      where: { entityId },
      order: { createdAt: 'DESC' },
    });
  }

  async transitionFilingStatus(
    entityId: string,
    filingId: string,
    nextStatus: FilingStatus,
  ): Promise<Filing> {
    const filing = await this.filingsRepo.findOne({
      where: { id: filingId, entityId },
    });
    if (!filing) {
      throw new NotFoundException(
        `Filing ${filingId} not found for entity ${entityId}`,
      );
    }

    const allowed = FILING_TRANSITIONS[filing.status];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException(
        `Cannot transition filing from ${filing.status} to ${nextStatus}. ` +
          `Allowed next states: ${allowed.length ? allowed.join(', ') : 'none (terminal state)'}`,
      );
    }

    filing.status = nextStatus;
    return this.filingsRepo.save(filing);
  }
}
