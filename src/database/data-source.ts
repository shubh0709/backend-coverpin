import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ComplianceEntity } from '../entities/entity.entity';
import { Filing } from '../entities/filing.entity';

/**
 * Used by the TypeORM CLI (migration:generate/run/revert), separate from the
 * NestJS-managed connection in app.module.ts which uses synchronize in dev.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [ComplianceEntity, Filing],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
