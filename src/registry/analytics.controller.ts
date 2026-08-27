import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegistryService } from './registry.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly registryService: RegistryService) {}

  @Get()
  @ApiOperation({
    summary:
      'Aggregated data for the four analytics charts: compliance breakdown, entity status by region, subsidiary/FQ counts, ownership % by parent.',
  })
  get(@Query() query: AnalyticsQueryDto) {
    return this.registryService.getAnalytics(query);
  }
}
