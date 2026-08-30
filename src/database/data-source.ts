import 'dotenv/config';
import { DataSource } from 'typeorm';
import { EntityRecord } from '../registry/entities/entity.entity';
import { OwnershipEdge } from '../registry/entities/ownership-edge.entity';
import { Filing } from '../registry/entities/filing.entity';
import { UploadJob } from '../registry/entities/upload-job.entity';

/**
 * Used by the TypeORM CLI (migration:generate/run/revert), separate from the
 * NestJS-managed connection in app.module.ts.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [EntityRecord, OwnershipEdge, Filing, UploadJob],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  // Matches app.module.ts's pool sizing (pg otherwise defaults to max: 10).
  extra: {
    max: Number(process.env.DB_POOL_MAX) || 20,
    min: Number(process.env.DB_POOL_MIN) || 4,
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS) || 30_000,
    connectionTimeoutMillis:
      Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS) || 5_000,
  },
});
