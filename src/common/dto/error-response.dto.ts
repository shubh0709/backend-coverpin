import { ApiProperty } from '@nestjs/swagger';

/** Shape every thrown error is normalized into by HttpExceptionFilter. */
export class ErrorResponseDto {
  @ApiProperty({ example: 400, description: 'HTTP status code.' })
  statusCode: number;

  @ApiProperty({
    example: '/api/entities',
    description: 'Request path that produced the error.',
  })
  path: string;

  @ApiProperty({
    example: '2026-08-27T10:15:30.000Z',
    description: 'ISO 8601 timestamp of when the error was generated.',
  })
  timestamp: string;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'All three files are required.',
    description:
      'Human-readable error message. An array when it comes from request validation (one entry per failed field).',
  })
  message: string | string[];

  @ApiProperty({
    required: false,
    example: 'Bad Request',
    description: 'Short HTTP status text, when available.',
  })
  error?: string;
}
