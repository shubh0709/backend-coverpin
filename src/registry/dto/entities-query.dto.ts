import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ENTITY_STATUSES } from '../entities/entity.entity';
import { COMPLIANCE_STATUSES } from './entities-response.dto';

export class EntitiesQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive substring match on Entity Name. Only matches the top-level entity, not its children.',
    example: 'northwind',
  })
  @IsOptional()
  @IsString()
  search?: string;

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
