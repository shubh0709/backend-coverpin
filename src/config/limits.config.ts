import { registerAs } from '@nestjs/config';

/** Defaults match what was previously hardcoded, so behavior is unchanged
 * until one of these env vars is actually set. */
export default registerAs('limits', () => ({
  maxUploadFileSizeBytes:
    Number(process.env.MAX_UPLOAD_FILE_SIZE_BYTES) || 10 * 1024 * 1024,
  maxUploadRowsPerFile: Number(process.env.MAX_UPLOAD_ROWS_PER_FILE) || 50_000,
  uploadBatchChunkSize: Number(process.env.UPLOAD_BATCH_CHUNK_SIZE) || 500,
}));
