import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegistryService } from './registry.service';
import { EntitiesQueryDto } from './dto/entities-query.dto';
import { EntitiesListResponseDto } from './dto/entities-response.dto';

@ApiTags('entities')
@Controller('entities')
export class EntitiesController {
  constructor(private readonly registryService: RegistryService) {}

  @Get()
  @ApiOperation({
    summary:
      'List top-level entities (paginated), each expandable to its FQs and subsidiaries.',
    description: `A "top-level" entity is one with no incoming ownership edge — nobody owns it.
Each entity gets its own independently computed \`complianceStatus\` and \`nextDueDate\`,
including its children. \`children\` nests recursively to arbitrary depth. Results are
paginated by top-level entity (see \`page\`/\`pageSize\`); \`entityStatus\`, \`complianceStatus\`,
and \`jurisdiction\` filters apply only to the top-level entity's own fields, while \`search\`
is matched in the database against the entity name at every level (top-level or any
descendant) — a top-level row survives if it or any descendant matches.`,
  })
  @ApiOkResponse({ type: EntitiesListResponseDto })
  list(@Query() query: EntitiesQueryDto) {
    return this.registryService.getEntitiesList(query);
  }

  @Get('jurisdictions')
  @ApiOperation({
    summary: 'Distinct jurisdictions across every entity, for filter dropdowns.',
  })
  jurisdictions() {
    return this.registryService.getJurisdictions();
  }
}
