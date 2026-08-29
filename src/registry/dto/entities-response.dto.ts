import { ApiProperty } from '@nestjs/swagger';
import { ENTITY_TYPES, ENTITY_STATUSES } from '../entities/entity.entity';

export const COMPLIANCE_STATUSES = [
  'NOT_APPLICABLE',
  'TBD',
  'GOOD_STANDING',
  'FILING_DUE',
  'OVERDUE',
  'SUSPENDED',
] as const;

export class EntityChildDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Northwind Manufacturing Corp' })
  entityName: string;

  @ApiProperty({
    enum: ['Entity', 'FQ'],
    description: 'FQs are foreign qualifications of a domestic Entity.',
  })
  registrationType: 'Entity' | 'FQ';

  @ApiProperty({
    enum: ['subsidiary', 'fq'],
    description:
      'Why this row is nested under its parent: an owned subsidiary (via ownership.csv) or a foreign qualification of the same legal entity.',
  })
  relation: 'subsidiary' | 'fq';

  @ApiProperty({ example: 'United States/Delaware' })
  jurisdiction: string;

  @ApiProperty({ enum: ENTITY_TYPES })
  entityType: string;

  @ApiProperty({ enum: ENTITY_STATUSES })
  entityStatus: string;

  @ApiProperty({ enum: COMPLIANCE_STATUSES })
  complianceStatus: string;

  @ApiProperty({
    format: 'date',
    nullable: true,
    example: '2026-03-01',
    description:
      'Earliest due date among this row’s not-yet-Filed/Canceled filings; null if none.',
  })
  nextDueDate: string | null;

  @ApiProperty({
    nullable: true,
    example: 70,
    description:
      'Percent of this child owned by the top-level parent. Always null for FQ rows — ownership does not apply to them.',
  })
  ownershipPct: number | null;

  @ApiProperty({
    example: false,
    description:
      "Whether this row's own Entity Name contains the `search` term (case-insensitive substring) — false when no search is active. The client uses this to auto-expand the path down to, and highlight, a matching descendant.",
  })
  matchesSearch: boolean;
}

export class EntityListItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Northwind Holdings Inc' })
  entityName: string;

  @ApiProperty({ enum: ['Entity'] })
  registrationType: 'Entity';

  @ApiProperty({ example: 'United States/Delaware' })
  jurisdiction: string;

  @ApiProperty({ enum: ENTITY_TYPES })
  entityType: string;

  @ApiProperty({ enum: ENTITY_STATUSES })
  entityStatus: string;

  @ApiProperty({ enum: COMPLIANCE_STATUSES })
  complianceStatus: string;

  @ApiProperty({ format: 'date', nullable: true, example: '2026-03-01' })
  nextDueDate: string | null;

  @ApiProperty({
    example: 2,
    description: 'children.length restricted to relation === "subsidiary".',
  })
  subsidiaryCount: number;

  @ApiProperty({
    example: 1,
    description: 'children.length restricted to relation === "fq".',
  })
  fqCount: number;

  @ApiProperty({
    type: [EntityChildDto],
    description:
      'This entity’s FQs followed by its direct subsidiaries, recursively nested to arbitrary depth.',
  })
  children: EntityChildDto[];

  @ApiProperty({
    example: false,
    description:
      "Whether this row's own Entity Name contains the `search` term (case-insensitive substring); false when no search is active.",
  })
  matchesSearch: boolean;
}

export class EntitiesListResponseDto {
  @ApiProperty({ type: [EntityListItemDto] })
  data: EntityListItemDto[];

  @ApiProperty({ example: 1, description: '1-indexed current page.' })
  page: number;

  @ApiProperty({ example: 10, description: 'Rows per page.' })
  pageSize: number;

  @ApiProperty({
    example: 8,
    description:
      'Total top-level entities matching the current filters, across all pages.',
  })
  total: number;

  @ApiProperty({ example: 1, description: 'Total number of pages.' })
  totalPages: number;
}
