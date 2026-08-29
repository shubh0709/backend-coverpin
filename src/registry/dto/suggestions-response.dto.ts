import { ApiProperty } from '@nestjs/swagger';
import { ENTITY_TYPES } from '../entities/entity.entity';

export class EntitySuggestionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Northwind Holdings Inc' })
  entityName: string;

  @ApiProperty({
    enum: ['Entity', 'FQ'],
    description: 'FQs are foreign qualifications of a domestic Entity.',
  })
  registrationType: 'Entity' | 'FQ';

  @ApiProperty({ example: 'United States/Delaware' })
  jurisdiction: string;

  @ApiProperty({ enum: ENTITY_TYPES })
  entityType: string;
}

export class SuggestionsResponseDto {
  @ApiProperty({
    type: [EntitySuggestionDto],
    description:
      'Ranked by where the query appears in the name (earliest first), then name length, then alphabetically.',
  })
  suggestions: EntitySuggestionDto[];
}
