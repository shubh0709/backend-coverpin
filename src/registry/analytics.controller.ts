import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegistryService } from './registry.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { AnalyticsResponseDto } from './dto/analytics-response.dto';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly registryService: RegistryService) {}

  @Get()
  @ApiOperation({
    summary: 'Aggregated data for the four analytics charts, in one call.',
    description: `Returns, together: compliance-status breakdown, entity status counts by region,
subsidiary/FQ counts per top-level entity, and ownership % breakdown for one selected
parent. \`jurisdiction\` and \`entityStatus\` filter every chart's underlying entity set;
\`parentEntityId\` only affects \`ownershipByParent\` — see \`ownershipByParent.parents\`
in the response for valid ids to pass back in on the next call.`,
  })
  @ApiOkResponse({ type: AnalyticsResponseDto })
  get(@Query() query: AnalyticsQueryDto) {
    return this.registryService.getAnalytics(query);
  }
}
