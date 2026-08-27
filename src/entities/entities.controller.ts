import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EntitiesService } from './entities.service';
import { CreateEntityDto } from './dto/create-entity.dto';
import { UpdateEntityDto } from './dto/update-entity.dto';
import { CreateFilingDto } from './dto/create-filing.dto';
import { UpdateFilingStatusDto } from './dto/update-filing-status.dto';
import { AiService } from '../ai/ai.service';

@ApiTags('entities')
@Controller('entities')
export class EntitiesController {
  constructor(
    private readonly entitiesService: EntitiesService,
    private readonly aiService: AiService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Register a new compliance entity' })
  create(@Body() dto: CreateEntityDto) {
    return this.entitiesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all entities with their filings' })
  findAll() {
    return this.entitiesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single entity with its filings' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.entitiesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update entity details or status' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEntityDto) {
    return this.entitiesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an entity' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.entitiesService.remove(id);
  }

  @Post(':id/filings')
  @ApiOperation({ summary: 'Create a filing for an entity (starts as PENDING)' })
  addFiling(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateFilingDto) {
    return this.entitiesService.addFiling(id, dto);
  }

  @Get(':id/filings')
  @ApiOperation({ summary: 'List filings for an entity' })
  listFilings(@Param('id', ParseUUIDPipe) id: string) {
    return this.entitiesService.listFilings(id);
  }

  @Patch(':id/filings/:filingId/status')
  @ApiOperation({
    summary: 'Transition a filing to its next lifecycle status',
    description: 'PENDING -> AI_PROCESSING -> FILED -> CONFIRMED (forward-only)',
  })
  transitionFiling(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('filingId', ParseUUIDPipe) filingId: string,
    @Body() dto: UpdateFilingStatusDto,
  ) {
    return this.entitiesService.transitionFilingStatus(id, filingId, dto.status);
  }

  @Post(':id/compliance-checklist')
  @ApiOperation({
    summary: 'AI: generate a compliance checklist for this entity',
    description:
      'Calls the configured LLM with the entity\'s jurisdiction/type/status and ' +
      'returns a structured checklist of likely upcoming filings. Result is persisted ' +
      'on the entity as lastComplianceCheck for audit purposes.',
  })
  async generateComplianceChecklist(@Param('id', ParseUUIDPipe) id: string) {
    const entity = await this.entitiesService.findOne(id);
    const result = await this.aiService.generateComplianceChecklist(entity);
    return this.entitiesService.saveComplianceCheck(id, result as unknown as Record<string, unknown>);
  }
}
