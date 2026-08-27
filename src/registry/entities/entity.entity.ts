import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const REGISTRATION_TYPES = ['Entity', 'FQ'] as const;
export type RegistrationType = (typeof REGISTRATION_TYPES)[number];

export const ENTITY_TYPES = [
  'Corporation',
  'Limited Liability Company',
  'Limited Partnership',
  'General Partnership',
  'Nonprofit',
  'Trust',
] as const;
export type EntityTypeValue = (typeof ENTITY_TYPES)[number];

export const ENTITY_STATUSES = [
  'In Formation',
  'Active',
  'Revoked/Terminated',
  'Merged/Acquired',
  'Divested/Sold',
  'Dormant',
  'Dissolved',
] as const;
export type EntityStatusValue = (typeof ENTITY_STATUSES)[number];

export const TERMINAL_ENTITY_STATUSES: ReadonlySet<string> = new Set([
  'Revoked/Terminated',
  'Merged/Acquired',
  'Divested/Sold',
  'Dormant',
  'Dissolved',
]);

export const GLOBAL_REGIONS = [
  'North America',
  'Asia Pacific',
  'Europe Middle East Africa',
  'Latin America',
  'European Economic Area',
] as const;
export type GlobalRegion = (typeof GLOBAL_REGIONS)[number];

/** One row from entities.csv — a top-level Entity, a subsidiary Entity, or an FQ. */
@Entity({ name: 'entities' })
export class EntityRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_name', type: 'text', unique: true })
  entityName: string;

  @Column({ name: 'registration_type', type: 'text' })
  registrationType: RegistrationType;

  @Column({ type: 'text' })
  jurisdiction: string;

  @Column({ name: 'entity_type', type: 'text' })
  entityType: EntityTypeValue;

  @Column({ name: 'entity_status', type: 'text' })
  entityStatus: EntityStatusValue;

  @Column({ name: 'status_date', type: 'date', nullable: true })
  statusDate: string | null;

  @Column({ name: 'domestic_entity_id', type: 'uuid', nullable: true })
  domesticEntityId: string | null;

  @ManyToOne(() => EntityRecord, { nullable: true })
  @JoinColumn({ name: 'domestic_entity_id' })
  domesticEntity: EntityRecord | null;

  @Column({ name: 'formation_date', type: 'date', nullable: true })
  formationDate: string | null;

  @Column({ name: 'business_id', type: 'text', nullable: true })
  businessId: string | null;

  @Column({ name: 'global_region', type: 'text', nullable: true })
  globalRegion: GlobalRegion | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
