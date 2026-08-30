import { parentPort, workerData } from 'worker_threads';
import { Client } from 'pg';
import {
  Queryable,
  UploadBatchOutcome,
  UploadBatchRows,
  writeUploadBatch,
} from './upload-writer';

interface WorkerInput {
  rows: UploadBatchRows;
  databaseUrl: string;
  chunkSize: number;
  ssl: boolean;
}

/** Wraps a raw `pg` client to match `Queryable` — `EntityManager.query()`
 * (the other implementation of this interface, used on the main thread)
 * returns rows directly, while `pg`'s `client.query()` returns `{ rows }`. */
function pgClientAsQueryable(client: Client): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const result = await client.query(sql, params);
      return result.rows as T[];
    },
  };
}

/** Runs the local-fallback path for POST /upload/async: given the parsed +
 * validated rows already persisted on the job (workerData), writes them to
 * entities/ownership_edges/filings in one transaction, off the main thread.
 * Uses a plain `pg` client (not the app's TypeORM DataSource, which workers
 * can't share) — mirrors file-parser.worker.ts's workerData-in /
 * postMessage-out shape. */
async function run() {
  const { rows, databaseUrl, chunkSize, ssl } = workerData as WorkerInput;

  const client = new Client({
    connectionString: databaseUrl,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    await client.query('BEGIN');
    const result = await writeUploadBatch(
      rows,
      pgClientAsQueryable(client),
      chunkSize,
    );
    await client.query('COMMIT');
    parentPort!.postMessage({ ok: true, result } satisfies UploadBatchOutcome);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    const message = e instanceof Error ? e.message : String(e);
    parentPort!.postMessage({
      ok: false,
      error: message,
    } satisfies UploadBatchOutcome);
  } finally {
    await client.end();
  }
}

void run();
