import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ENTITY_STATUSES } from '../entities/entity.entity';
import { COMPLIANCE_STATUSES } from './entities-response.dto';

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export class EntitiesQueryDto {
  @ApiPropertyOptional({
    description:
      'Typo-tolerant match on Entity Name: case-insensitive substring matches always qualify, and close misspellings (small edit distance, scaled to query length) also qualify. Matches the top-level entity or any of its descendants (subsidiaries/FQs at any depth); a top-level row stays in the result set if any descendant matches, even if the top-level row itself does not. Results are ranked with the closest match first.',
    example: 'northwind',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: '1-indexed page of top-level entities to return.',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    enum: PAGE_SIZES,
    description: 'Number of top-level entities per page.',
    default: 10,
  })
  @IsOptional()
  @IsIn(PAGE_SIZES)
  pageSize?: number;

  @ApiPropertyOptional({
    enum: ENTITY_STATUSES,
    description: 'Exact match on the top-level entity’s Entity Status.',
  })
  @IsOptional()
  @IsString()
  entityStatus?: string;

  @ApiPropertyOptional({
    enum: COMPLIANCE_STATUSES,
    description:
      'Exact match on the top-level entity’s computed compliance status (not its children’s).',
  })
  @IsOptional()
  @IsString()
  complianceStatus?: string;

  @ApiPropertyOptional({
    description:
      'Exact match on the top-level entity’s Jurisdiction, e.g. "United States/Delaware".',
    example: 'United States/Delaware',
  })
  @IsOptional()
  @IsString()
  jurisdiction?: string;
}
