import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ENTITY_STATUSES } from '../entities/entity.entity';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    description:
      'Filters entities feeding all four charts down to this Jurisdiction, e.g. "United States/Delaware".',
    example: 'United States/Delaware',
  })
  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @ApiPropertyOptional({
    enum: ENTITY_STATUSES,
    description:
      'Filters entities feeding all four charts down to this Entity Status.',
  })
  @IsOptional()
  @IsString()
  entityStatus?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Parent entity id for the ownership-% chart; defaults to the first available parent (by name) if omitted or invalid. Get valid ids from `ownershipByParent.parents` in a prior response.',
  })
  @IsOptional()
  @IsUUID()
  parentEntityId?: string;
}
