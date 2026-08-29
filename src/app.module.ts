import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RegistryModule } from './registry/registry.module';
import { EntityRecord } from './registry/entities/entity.entity';
import { OwnershipEdge } from './registry/entities/ownership-edge.entity';
import { Filing } from './registry/entities/filing.entity';
import limitsConfig from './config/limits.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [limitsConfig] }),
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
          entities: [EntityRecord, OwnershipEdge, Filing],
          // Neon (and most managed Postgres) requires SSL; rejectUnauthorized:false
          // is standard for their pooled connection strings.
          ssl: isProd ? { rejectUnauthorized: false } : false,
          // Schema is owned by the migration in src/database/migrations — it has
          // CHECK constraints and a partial unique index that TypeORM's
          // synchronize can't express, so synchronize stays off everywhere.
          synchronize: false,
          logging: !isProd,
        };
      },
    }),
    RegistryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
