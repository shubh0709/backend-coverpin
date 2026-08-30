import { registerAs } from '@nestjs/config';

/** Per-IP request cap, applied globally. Default (600 req/min) is well above
 * this API's expected traffic so normal/scaled usage never trips it — it
 * exists to bound a single abusive/misbehaving client, not to throttle
 * legitimate load. */
export default registerAs('throttler', () => ({
  ttlMs: Number(process.env.THROTTLE_TTL_MS) || 60_000,
  limit: Number(process.env.THROTTLE_LIMIT) || 600,
}));
