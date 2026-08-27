import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRecord } from './entity.entity';

export const FILING_TYPES = [
  'Annual Report',
  'Statement of Information',
  'Franchise Tax',
  'Biennial Statement',
] as const;
export type FilingType = (typeof FILING_TYPES)[number];

export const FILING_STATUSES = [
  'Not Started',
  'In Progress',
  'Submitted',
  'Filed',
  'Rejected',
  'Canceled',
] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];

/** One row from filings.csv — hangs off either an Entity row or an FQ row. */
@Entity({ name: 'filings' })
export class Filing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @ManyToOne(() => EntityRecord)
  @JoinColumn({ name: 'entity_id' })
  entity: EntityRecord;

  @Column({ name: 'filing_type', type: 'text' })
  filingType: FilingType;

  @Column({ type: 'text' })
  jurisdiction: string;

  @Column({ name: 'filing_authority', type: 'text', nullable: true })
  filingAuthority: string | null;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ name: 'filed_date', type: 'date', nullable: true })
  filedDate: string | null;

  @Column({ type: 'text' })
  status: FilingStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
