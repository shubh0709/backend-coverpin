import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok'] })
  status: 'ok';

  @ApiProperty({ example: 'coverpin-backend' })
  service: string;

  @ApiProperty({ example: 12345, description: 'Process uptime, in seconds.' })
  uptimeSeconds: number;

  @ApiProperty({ example: '2026-08-27T10:15:30.000Z' })
  timestamp: string;
}
