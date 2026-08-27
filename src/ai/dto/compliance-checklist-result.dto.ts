import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ComplianceChecklistItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  filingType: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description: string;

  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  priority: 'LOW' | 'MEDIUM' | 'HIGH';

  @IsOptional()
  @IsString()
  suggestedDueDate?: string;
}

/** Shape the LLM must return. Anything that fails this validation is rejected. */
export class ComplianceChecklistResultDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ComplianceChecklistItemDto)
  items: ComplianceChecklistItemDto[];

  @IsString()
  summary: string;
}
