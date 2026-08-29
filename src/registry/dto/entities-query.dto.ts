import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ENTITY_STATUSES } from '../entities/entity.entity';
import { COMPLIANCE_STATUSES } from './entities-response.dto';

export const PAGE_SIZES = [10, 25, 50, 100] as const;

/** No legitimate Entity Name search needs more than this; caps how much
 * work the DB does per request (ILIKE pattern size, recursive subtree scan). */
const MAX_SEARCH_LENGTH = 200;

export class EntitiesQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive substring match on Entity Name. Matches the top-level entity or any of its descendants (subsidiaries/FQs at any depth); a top-level row stays in the result set if any descendant matches, even if the top-level row itself does not.',
    example: 'northwind',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
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
