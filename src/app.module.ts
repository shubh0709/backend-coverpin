import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RegistryModule } from './registry/registry.module';
import { EntityRecord } from './registry/entities/entity.entity';
import { OwnershipEdge } from './registry/entities/ownership-edge.entity';
import { Filing } from './registry/entities/filing.entity';
import limitsConfig from './config/limits.config';
import databaseConfig from './config/database.config';
import throttlerConfig from './config/throttler.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [limitsConfig, databaseConfig, throttlerConfig],
    }),
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
          // pg defaults to a max pool of 10, shared by every concurrent
          // request on this single Node process — too low once traffic is
          // more than a handful of requests in flight at once.
          extra: {
            max: config.get<number>('database.poolMax'),
            min: config.get<number>('database.poolMin'),
            idleTimeoutMillis: config.get<number>('database.idleTimeoutMillis'),
            connectionTimeoutMillis: config.get<number>(
              'database.connectionTimeoutMillis',
            ),
          },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('throttler.ttlMs')!,
          limit: config.get<number>('throttler.limit')!,
        },
      ],
    }),
    RegistryModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
