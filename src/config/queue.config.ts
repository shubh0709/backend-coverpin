import { registerAs } from '@nestjs/config';

/** Backs POST /upload/async's QStash dispatch (QueueDispatchService). All
 * optional — if `token` or `publicBaseUrl` is unset, publish() short-
 * circuits straight to the local-fallback path (this is what makes local
 * dev, where QStash can't reach localhost, exercise the fallback by
 * default; see the plan's "Local dev note"). */
export default registerAs('queue', () => ({
  qstashToken: process.env.QSTASH_TOKEN || null,
  qstashCurrentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY || null,
  qstashNextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || null,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
  publishTimeoutMs: Number(process.env.QSTASH_PUBLISH_TIMEOUT_MS) || 5000,
  // Backs UploadReconciliationService: a job still 'queued' longer than this
  // is treated as stuck (QStash accepted the publish but never delivered
  // it) and run through the local fallback instead.
  staleJobAfterMs: Number(process.env.UPLOAD_JOB_STALE_AFTER_MS) || 120_000,
}));
