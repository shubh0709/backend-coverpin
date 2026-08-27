import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class EntitiesQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on Entity Name.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  complianceStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jurisdiction?: string;
}
