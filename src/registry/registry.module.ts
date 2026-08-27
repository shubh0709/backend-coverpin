import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityRecord } from './entities/entity.entity';
import { OwnershipEdge } from './entities/ownership-edge.entity';
import { Filing } from './entities/filing.entity';
import { FileParserService } from './parsing/file-parser.service';
import { ValidationService } from './validation/validation.service';
import { RegistryService } from './registry.service';
import { UploadController } from './upload.controller';
import { EntitiesController } from './entities.controller';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EntityRecord, OwnershipEdge, Filing])],
  controllers: [UploadController, EntitiesController, AnalyticsController],
  providers: [FileParserService, ValidationService, RegistryService],
})
export class RegistryModule {}
