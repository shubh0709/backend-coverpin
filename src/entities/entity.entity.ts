import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Filing } from './filing.entity';

export enum EntityType {
  LLC = 'LLC',
  C_CORP = 'C_CORP',
  S_CORP = 'S_CORP',
  PARTNERSHIP = 'PARTNERSHIP',
  NONPROFIT = 'NONPROFIT',
}

export enum EntityStatus {
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
  SUSPENDED = 'SUSPENDED',
  DISSOLVED = 'DISSOLVED',
}

/**
 * A registered business entity (LLC, corp, etc). Jurisdiction uses a
 * "COUNTRY-SUBDIVISION" style code (e.g. "US-DE", "US-CA", "CA-ON") since
 * compliance requirements are jurisdiction-specific.
 */
@Entity('compliance_entities')
export class ComplianceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'enum', enum: EntityType })
  entityType: EntityType;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  jurisdiction: string;

  @Index()
  @Column({ type: 'enum', enum: EntityStatus, default: EntityStatus.PENDING })
  status: EntityStatus;

  @Column({ type: 'date', nullable: true })
  formationDate: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  registeredAgent: string | null;

  @Column({ type: 'jsonb', nullable: true })
  lastComplianceCheck: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastCheckedAt: Date | null;

  @OneToMany(() => Filing, (filing) => filing.entity)
  filings: Filing[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
