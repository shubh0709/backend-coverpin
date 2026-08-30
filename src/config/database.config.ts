import { registerAs } from '@nestjs/config';

/** pg pool sizing for the NestJS-managed connection (app.module.ts). Defaults
 * raise the pg default (max: 10) enough to cover concurrent request bursts
 * without unbounded growth; idle/connection timeouts keep a stuck DB from
 * hanging requests indefinitely. */
export default registerAs('database', () => ({
  poolMax: Number(process.env.DB_POOL_MAX) || 20,
  poolMin: Number(process.env.DB_POOL_MIN) || 4,
  idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS) || 30_000,
  connectionTimeoutMillis:
    Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS) || 5_000,
}));
