import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyticsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityStatus?: string;

  @ApiPropertyOptional({
    description:
      'Parent entity id for the ownership-% chart; defaults to the first available parent.',
  })
  @IsOptional()
  @IsUUID()
  parentEntityId?: string;
}
