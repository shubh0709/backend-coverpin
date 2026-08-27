import 'dotenv/config';
import { DataSource } from 'typeorm';
import { EntityRecord } from '../registry/entities/entity.entity';
import { OwnershipEdge } from '../registry/entities/ownership-edge.entity';
import { Filing } from '../registry/entities/filing.entity';

/**
 * Used by the TypeORM CLI (migration:generate/run/revert), separate from the
 * NestJS-managed connection in app.module.ts.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [EntityRecord, OwnershipEdge, Filing],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});
