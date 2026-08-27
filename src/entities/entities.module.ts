import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceEntity } from './entity.entity';
import { Filing } from './filing.entity';
import { EntitiesService } from './entities.service';
import { EntitiesController } from './entities.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([ComplianceEntity, Filing]), AiModule],
  controllers: [EntitiesController],
  providers: [EntitiesService],
  exports: [EntitiesService],
})
export class EntitiesModule {}
