import { ApiProperty } from '@nestjs/swagger';
import { ENTITY_STATUSES, GLOBAL_REGIONS } from '../entities/entity.entity';
import { COMPLIANCE_STATUSES } from './entities-response.dto';

export class ComplianceBreakdownItemDto {
  @ApiProperty({ enum: COMPLIANCE_STATUSES })
  status: string;

  @ApiProperty({ example: 12 })
  count: number;
}

export class EntityStatusByRegionItemDto {
  @ApiProperty({
    enum: [...GLOBAL_REGIONS, 'Unspecified'],
    description: 'Entities with no Global Region bucket into "Unspecified".',
  })
  region: string;

  @ApiProperty({ enum: ENTITY_STATUSES })
  entityStatus: string;

  @ApiProperty({ example: 5 })
  count: number;
}

export class SubsidiaryFqCountItemDto {
  @ApiProperty({ example: 'Northwind Holdings Inc' })
  entityName: string;

  @ApiProperty({
    example: 2,
    description: 'Count included even when zero, for every top-level entity.',
  })
  subsidiaries: number;

  @ApiProperty({ example: 1 })
  fqs: number;
}

export class OwnershipParentOptionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Northwind Holdings Inc' })
  entityName: string;
}

export class OwnershipChildShareDto {
  @ApiProperty({ example: 'Northwind Manufacturing Corp' })
  entityName: string;

  @ApiProperty({ example: 70 })
  pct: number;
}

export class OwnershipByParentDto {
  @ApiProperty({
    type: [OwnershipParentOptionDto],
    description:
      'Every entity that owns at least one child — the picker list for `parentEntityId`.',
  })
  parents: OwnershipParentOptionDto[];

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description:
      'The parent actually used to build `children` below — echoes `parentEntityId` if valid, otherwise defaults to the first entry in `parents`. Null when there are no parents at all.',
  })
  selectedParentId: string | null;

  @ApiProperty({ type: [OwnershipChildShareDto] })
  children: OwnershipChildShareDto[];

  @ApiProperty({
    example: 5,
    description:
      "100 minus the sum of `children[].pct`, floored at 0 — the slice of the selected parent's ownership pie that isn't accounted for by known children.",
  })
  unallocatedPct: number;
}

export class AnalyticsResponseDto {
  @ApiProperty({
    type: [ComplianceBreakdownItemDto],
    description:
      'Count of every entities.csv row by computed compliance status.',
  })
  complianceBreakdown: ComplianceBreakdownItemDto[];

  @ApiProperty({ type: [EntityStatusByRegionItemDto] })
  entityStatusByRegion: EntityStatusByRegionItemDto[];

  @ApiProperty({
    type: [SubsidiaryFqCountItemDto],
    description: 'One row per top-level entity (no incoming ownership edge).',
  })
  subsidiaryFqCountByTopLevel: SubsidiaryFqCountItemDto[];

  @ApiProperty({ type: OwnershipByParentDto })
  ownershipByParent: OwnershipByParentDto;
}
