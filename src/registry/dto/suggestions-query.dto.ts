import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export const SUGGESTIONS_DEFAULT_LIMIT = 8;
export const SUGGESTIONS_MAX_LIMIT = 20;

export class SuggestionsQueryDto {
  @ApiProperty({
    description:
      'Typo-tolerant query, matched the same way as `search` on GET /entities (substring or fuzzy). Every entity at any level (top-level, subsidiary, or FQ) is a candidate.',
    example: 'northwnd',
  })
  @IsString()
  @MinLength(1)
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
