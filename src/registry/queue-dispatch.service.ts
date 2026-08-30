import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as QStashClient } from '@upstash/qstash';
import { Worker } from 'worker_threads';
import * as path from 'path';
import { RegistryService } from './registry.service';
import { UploadJobsService } from './upload-jobs.service';
import { UploadJob } from './entities/upload-job.entity';
import { UploadBatchOutcome, UploadBatchRows } from './upload-writer';

export type DispatchMethod = 'qstash' | 'local-fallback';

/** Publishes POST /upload/async jobs to QStash (primary path) and, if
 * publishing fails (or a job is later found stuck, see
 * UploadReconciliationService), runs them immediately via a worker_threads
 * worker (fallback path — see upload-writer.worker.ts). */
@Injectable()
export class QueueDispatchService {
  private readonly logger = new Logger(QueueDispatchService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly uploadJobsService: UploadJobsService,
    private readonly registryService: RegistryService,
  ) {}

  /** Attempts to publish `jobId` to QStash, which will later POST it back to
   * this app's /upload/async/callback route. Returns whether the publish
   * itself succeeded — never throws, so the caller can always fall back. */
  async publish(jobId: string): Promise<boolean> {
    const token = this.configService.get<string>('queue.qstashToken');
    const publicBaseUrl = this.configService.get<string>('queue.publicBaseUrl');
    if (!token || !publicBaseUrl) {
      this.logger.log(
        `QStash not configured (QSTASH_TOKEN/PUBLIC_BASE_URL unset) -- using local fallback for job ${jobId}.`,
      );
      return false;
    }

    const timeoutMs = this.configService.get<number>('queue.publishTimeoutMs')!;
    const client = new QStashClient({ token });
    const callbackUrl = `${publicBaseUrl.replace(/\/+$/, '')}/api/upload/async/callback`;

    try {
      await this.withTimeout(
        client.publishJSON({ url: callbackUrl, body: { jobId } }),
        timeoutMs,
      );
      return true;
    } catch (e) {
      this.logger.warn(
        `QStash publish failed for job ${jobId}, using local fallback: ${e instanceof Error ? e.message : e}`,
      );
      return false;
    }
  }

  /** Claims `job` (a no-op if something else already claimed it — the QStash
   * callback, or an earlier/concurrent call to this same method) and runs it
   * via the local worker_threads fallback, recording the outcome. Called
   * both right after a failed publish() (UploadAsyncController) and by
   * UploadReconciliationService's stale-job sweep — one place that knows how
   * to actually get a job written when QStash isn't doing it. */
  async runFallback(job: UploadJob): Promise<void> {
    if (!(await this.uploadJobsService.claim(job.id))) return;

    const outcome = await this.runLocalFallbackWorker(
      job.payload as UploadBatchRows,
    );
    if (outcome.ok) {
      this.registryService.invalidateAnalyticsCache();
      await this.uploadJobsService.markCompleted(job.id, outcome.result);
    } else {
      await this.uploadJobsService.markFailed(job.id, outcome.error);
    }
  }

  /** Runs the job right now, off the main thread, via upload-writer.worker.ts. */
  private runLocalFallbackWorker(
    rows: UploadBatchRows,
  ): Promise<UploadBatchOutcome> {
    const databaseUrl = this.configService.get<string>('DATABASE_URL')!;
    const chunkSize = this.configService.get<number>(
      'limits.uploadBatchChunkSize',
    )!;
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';

    return new Promise((resolve) => {
      const worker = new Worker(
        path.join(__dirname, 'upload-writer.worker.js'),
        { workerData: { rows, databaseUrl, chunkSize, ssl: isProd } },
      );

      worker.once('message', (msg: UploadBatchOutcome) => resolve(msg));
      worker.once('error', (err: Error) =>
        resolve({ ok: false, error: err.message }),
      );
      worker.once('exit', (code) => {
        if (code !== 0) {
          resolve({
            ok: false,
            error: `upload-writer worker stopped with exit code ${code}`,
          });
        }
      });
    });
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`QStash publish timed out after ${ms}ms`)),
        ms,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }
}
