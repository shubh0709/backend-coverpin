import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegistryService } from './registry.service';
import { EntitiesQueryDto } from './dto/entities-query.dto';

@ApiTags('entities')
@Controller('entities')
export class EntitiesController {
  constructor(private readonly registryService: RegistryService) {}

  @Get()
  @ApiOperation({
    summary:
      'List top-level entities (one row each), expandable to their direct FQs and subsidiaries, with search/filter support.',
  })
  list(@Query() query: EntitiesQueryDto) {
    return this.registryService.getEntitiesList(query);
  }
}
