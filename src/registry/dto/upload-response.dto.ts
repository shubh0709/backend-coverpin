import { ApiProperty } from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';

export class UploadResultDto {
  @ApiProperty({
    example: 42,
    description: 'Number of rows upserted from entities.csv.',
  })
  entities: number;

  @ApiProperty({
    example: 17,
    description: 'Number of rows upserted from ownership.csv.',
  })
  ownershipEdges: number;

  @ApiProperty({
    example: 63,
    description: 'Number of rows upserted from filings.csv.',
  })
  filings: number;
}

export class ValidationErrorDto {
  @ApiProperty({
    example: 'entities.csv',
    description: 'Which of the three uploaded files the error is in.',
  })
  file: string;

  @ApiProperty({
    example: 4,
    description:
      'Spreadsheet-native line number the error was found on (header is line 1).',
  })
  line: number;

  @ApiProperty({
    example: 'Entity Status',
    description: 'Column name the error relates to.',
  })
  column: string;

  @ApiProperty({
    example:
      "Value 'Active-ish' is not one of the allowed Entity Status values.",
    description: 'Human-readable description of what is wrong.',
  })
  message: string;
}

/**
 * Returned on 422 instead of ErrorResponseDto — the whole batch is rejected
 * with every row-level problem reported at once, sorted file → line → column.
 */
export class UploadValidationErrorResponseDto extends ErrorResponseDto {
  @ApiProperty({ type: [ValidationErrorDto] })
  errors: ValidationErrorDto[];
}
