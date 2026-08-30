import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityRecord } from './entities/entity.entity';
import { OwnershipEdge } from './entities/ownership-edge.entity';
import { Filing } from './entities/filing.entity';
import { UploadJob } from './entities/upload-job.entity';
import { FileParserService } from './parsing/file-parser.service';
import { ValidationService } from './validation/validation.service';
import { RegistryService } from './registry.service';
import { QueueDispatchService } from './queue-dispatch.service';
import { UploadJobsService } from './upload-jobs.service';
import { UploadReconciliationService } from './upload-reconciliation.service';
import { UploadController } from './upload.controller';
import { UploadAsyncController } from './upload-async.controller';
import { EntitiesController } from './entities.controller';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([EntityRecord, OwnershipEdge, Filing, UploadJob]),
  ],
  controllers: [
    UploadController,
    UploadAsyncController,
    EntitiesController,
    AnalyticsController,
  ],
  providers: [
    FileParserService,
    ValidationService,
    RegistryService,
    QueueDispatchService,
    UploadJobsService,
    UploadReconciliationService,
  ],
})
export class RegistryModule {}
