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

/** parent_entity_id -> child_entity_id, a graph edge — never a single-parent tree column. */
@Entity({ name: 'ownership_edges' })
export class OwnershipEdge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'parent_entity_id', type: 'uuid' })
  parentEntityId: string;

  @ManyToOne(() => EntityRecord)
  @JoinColumn({ name: 'parent_entity_id' })
  parentEntity: EntityRecord;

  @Column({ name: 'child_entity_id', type: 'uuid' })
  childEntityId: string;

  @ManyToOne(() => EntityRecord)
  @JoinColumn({ name: 'child_entity_id' })
  childEntity: EntityRecord;

  @Column({ name: 'ownership_pct', type: 'numeric', precision: 5, scale: 2 })
  ownershipPct: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
