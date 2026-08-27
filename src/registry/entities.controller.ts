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
      'List top-level entities, each expandable to its direct FQs and subsidiaries.',
    description: `A "top-level" entity is one with no incoming ownership edge — nobody owns it.
Each entity gets its own independently computed \`complianceStatus\` and \`nextDueDate\`,
including its children. \`children\` nests exactly **one level deep**: a subsidiary's own
subsidiaries exist in the data but are not returned here (fetch them by listing/expanding
that subsidiary separately if needed). Query filters apply only to the top-level entity's
own fields, not its children's.`,
  })
  @ApiOkResponse({ type: EntitiesListResponseDto })
  list(@Query() query: EntitiesQueryDto) {
    return this.registryService.getEntitiesList(query);
  }
}
