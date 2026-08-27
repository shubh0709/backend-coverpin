import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { FilingType } from '../filing.entity';

export class CreateFilingDto {
  @ApiProperty({ enum: FilingType, example: FilingType.ANNUAL_REPORT })
  @IsEnum(FilingType)
  filingType: FilingType;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ example: 'Filed via state e-filing portal' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
