import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export const SUGGESTIONS_DEFAULT_LIMIT = 8;
export const SUGGESTIONS_MAX_LIMIT = 20;

/** Mirrors EntitiesQueryDto's search cap — bounds ILIKE pattern size per request. */
const MAX_QUERY_LENGTH = 200;

export class SuggestionsQueryDto {
  @ApiProperty({
    description:
      'Case-insensitive substring query, matched the same way as `search` on GET /entities. Every entity at any level (top-level, subsidiary, or FQ) is a candidate.',
    example: 'northwind',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_QUERY_LENGTH)
  q: string;

  @ApiPropertyOptional({
    default: SUGGESTIONS_DEFAULT_LIMIT,
    description:
      'Maximum number of suggestions to return, closest match first.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SUGGESTIONS_MAX_LIMIT)
  limit?: number;
}
