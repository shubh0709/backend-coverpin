import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { FilingStatus } from '../filing.entity';

export class UpdateFilingStatusDto {
  @ApiProperty({ enum: FilingStatus, example: FilingStatus.AI_PROCESSING })
  @IsEnum(FilingStatus)
  status: FilingStatus;
}
