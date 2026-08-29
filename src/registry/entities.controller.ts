import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegistryService } from './registry.service';
import { EntitiesQueryDto } from './dto/entities-query.dto';
import { EntitiesListResponseDto } from './dto/entities-response.dto';
import {
  SuggestionsQueryDto,
  SUGGESTIONS_DEFAULT_LIMIT,
} from './dto/suggestions-query.dto';
import { SuggestionsResponseDto } from './dto/suggestions-response.dto';

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
including its children. \`children\` nests recursively to arbitrary depth. Filtering,
search, and pagination all run in the database: \`entityStatus\` and \`jurisdiction\` filter
top-level entities by their own column values; \`complianceStatus\` filters by the
top-level entity's own computed status (not its children's); \`search\` is a
case-insensitive substring match against the entity name at every level (top-level or any
descendant) — a top-level row survives if it or any descendant matches. Results are
paginated by top-level entity (see \`page\`/\`pageSize\`).`,
  })
  @ApiOkResponse({ type: EntitiesListResponseDto })
  list(@Query() query: EntitiesQueryDto) {
    return this.registryService.getEntitiesList(query);
  }

  @Get('jurisdictions')
  @ApiOperation({
    summary:
      'Distinct jurisdictions across every entity, for filter dropdowns.',
  })
  jurisdictions() {
    return this.registryService.getJurisdictions();
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'Entity Name suggestions for a search-bar autocomplete.',
    description: `Matches every entity (top-level, subsidiary, or FQ) by the same case-insensitive
substring match used by \`search\` on \`GET /entities\`, ranked by where the query appears in
the name, and returns the top \`limit\`. Meant to back a suggestions dropdown: selecting one
and re-searching by its exact \`entityName\` guarantees an exact match.`,
  })
  @ApiOkResponse({ type: SuggestionsResponseDto })
  suggestions(@Query() query: SuggestionsQueryDto) {
    return this.registryService.getEntitySuggestions(
      query.q,
      query.limit ?? SUGGESTIONS_DEFAULT_LIMIT,
    );
  }
}
