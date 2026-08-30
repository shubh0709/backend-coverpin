import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { UploadJobsService } from './upload-jobs.service';
import { QueueDispatchService } from './queue-dispatch.service';

// @Interval's argument is read at class-decoration time, before Nest's DI
// container (and so ConfigService) exists -- same env-read-before-DI
// constraint as upload.controller.ts's MAX_FILE_SIZE_BYTES, just for a
// decorator arg instead of a module-level const.
const SWEEP_INTERVAL_MS =
  Number(process.env.UPLOAD_JOB_RECONCILE_INTERVAL_MS) || 120_000;

/**
 * Render's free tier has no cron jobs, so if QStash *accepts* a
 * POST /upload/async job's publish but never delivers it (rare -- an
 * Upstash-side incident, or QueueDispatchService.publish's own timeout
 * firing just as QStash actually did receive it), that job would otherwise
 * sit 'queued' forever with nothing to notice. This sweep -- which, like
 * everything else here, only ever runs while this process happens to be
 * awake -- periodically finds such jobs and runs them through
 * QueueDispatchService.runFallback, the same claim-then-local-worker path
 * UploadAsyncController uses right after a failed publish().
 */
@Injectable()
export class UploadReconciliationService {
  private readonly logger = new Logger(UploadReconciliationService.name);

  constructor(
    private readonly uploadJobsService: UploadJobsService,
    private readonly queueDispatchService: QueueDispatchService,
    private readonly configService: ConfigService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async sweepStaleJobs() {
    const staleAfterMs = this.configService.get<number>(
      'queue.staleJobAfterMs',
    )!;
    const stale = await this.uploadJobsService.findStaleQueued(staleAfterMs);

    for (const job of stale) {
      this.logger.warn(
        `Job ${job.id} still queued after ${staleAfterMs}ms -- QStash may not have delivered it; running local fallback.`,
      );
      void this.queueDispatchService.runFallback(job);
    }
  }
}
