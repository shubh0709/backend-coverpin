import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateEntityDto } from './create-entity.dto';
import { EntityStatus } from '../entity.entity';

export class UpdateEntityDto extends PartialType(CreateEntityDto) {
  @ApiPropertyOptional({ enum: EntityStatus })
  @IsOptional()
  @IsEnum(EntityStatus)
  status?: EntityStatus;
}
