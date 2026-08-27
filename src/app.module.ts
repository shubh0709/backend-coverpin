import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EntitiesModule } from './entities/entities.module';
import { AiModule } from './ai/ai.module';
import { ComplianceEntity } from './entities/entity.entity';
import { Filing } from './entities/filing.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');
        if (!databaseUrl) {
          throw new Error('DATABASE_URL is not set. See .env.example.');
        }
        const isProd = config.get<string>('NODE_ENV') === 'production';
        return {
          type: 'postgres',
          url: databaseUrl,
          entities: [ComplianceEntity, Filing],
          // Neon (and most managed Postgres) requires SSL; rejectUnauthorized:false
          // is standard for their pooled connection strings.
          ssl: isProd ? { rejectUnauthorized: false } : false,
          // Convenient for this take-home-style scaffold; switch to migrations
          // (npm run migration:run) before treating this as production-grade.
          synchronize: !isProd,
          logging: !isProd,
        };
      },
    }),
    EntitiesModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
