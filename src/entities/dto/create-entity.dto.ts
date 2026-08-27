import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { EntityType } from '../entity.entity';

export class CreateEntityDto {
  @ApiProperty({ example: 'Acme Robotics LLC' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ enum: EntityType, example: EntityType.LLC })
  @IsEnum(EntityType)
  entityType: EntityType;

  @ApiProperty({
    example: 'US-DE',
    description: 'COUNTRY-SUBDIVISION code, e.g. US-DE, US-CA, CA-ON',
  })
  @IsString()
  @Matches(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, {
    message: 'jurisdiction must look like "US-DE", "US-CA" or "SG"',
  })
  jurisdiction: string;

  @ApiPropertyOptional({ example: '2021-06-01' })
  @IsOptional()
  @IsDateString()
  formationDate?: string;

  @ApiPropertyOptional({ example: 'Northwest Registered Agent' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  registeredAgent?: string;
}
