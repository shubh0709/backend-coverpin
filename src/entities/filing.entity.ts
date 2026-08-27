import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ComplianceEntity } from './entity.entity';

export enum FilingType {
  ANNUAL_REPORT = 'ANNUAL_REPORT',
  BOI_REPORT = 'BOI_REPORT',
  REGISTERED_AGENT_RENEWAL = 'REGISTERED_AGENT_RENEWAL',
  FRANCHISE_TAX = 'FRANCHISE_TAX',
  OTHER = 'OTHER',
}

/**
 * Filing lifecycle is a strict forward-only state machine:
 * PENDING -> AI_PROCESSING -> FILED -> CONFIRMED
 * Transitions are validated in FilingsService/EntitiesService, not here.
 */
export enum FilingStatus {
  PENDING = 'PENDING',
  AI_PROCESSING = 'AI_PROCESSING',
  FILED = 'FILED',
  CONFIRMED = 'CONFIRMED',
}

@Entity('filings')
export class Filing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  entityId: string;

  @ManyToOne(() => ComplianceEntity, (entity) => entity.filings, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'entityId' })
  entity: ComplianceEntity;

  @Column({ type: 'enum', enum: FilingType })
  filingType: FilingType;

  @Index()
  @Column({ type: 'enum', enum: FilingStatus, default: FilingStatus.PENDING })
  status: FilingStatus;

  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
