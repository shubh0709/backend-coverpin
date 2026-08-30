import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UploadJob,
  UploadJobDispatchMethod,
} from './entities/upload-job.entity';
import { UploadBatchResult, UploadBatchRows } from './upload-writer';

/** All `upload_jobs` reads/writes for POST /upload/async, in one place --
 * shared by UploadAsyncController (create/dispatch/poll, and the QStash-
 * callback claim), QueueDispatchService (the local-fallback claim + record),
 * and UploadReconciliationService (the stale-job sweep's claim). Centralizing
 * `claim()` in particular matters: it's the compare-and-swap that keeps two
 * dispatch paths from both writing the same job (see class docs on the
 * callers) -- one implementation, three callers, not three copies. */
@Injectable()
export class UploadJobsService {
  constructor(
    @InjectRepository(UploadJob)
    private readonly jobRepo: Repository<UploadJob>,
  ) {}

  create(payload: UploadBatchRows): Promise<UploadJob> {
    return this.jobRepo.save(
      this.jobRepo.create({ status: 'queued', payload }),
    );
  }

  findById(jobId: string): Promise<UploadJob | null> {
    return this.jobRepo.findOneBy({ id: jobId });
  }

  async setDispatchMethod(
    jobId: string,
    dispatchMethod: UploadJobDispatchMethod,
  ): Promise<void> {
    await this.jobRepo.update(jobId, { dispatchMethod });
  }

  /** Atomically transitions 'queued' -> 'processing'. Returns whether this
   * call won the race -- false means something else (another dispatch path,
   * or a duplicate QStash delivery) already claimed it, so the caller should
   * treat that as a no-op, not an error. */
  async claim(jobId: string): Promise<boolean> {
    const result = await this.jobRepo
      .createQueryBuilder()
      .update(UploadJob)
      .set({ status: 'processing' })
      .where('id = :jobId', { jobId })
      .andWhere('status = :queued', { queued: 'queued' })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async markCompleted(jobId: string, result: UploadBatchResult): Promise<void> {
    await this.jobRepo.update(jobId, { status: 'completed', result });
  }

  async markFailed(jobId: string, message: string): Promise<void> {
    await this.jobRepo.update(jobId, {
      status: 'failed',
      error: { message },
    });
  }

  /** Jobs still 'queued' after `olderThanMs` -- backs
   * UploadReconciliationService's stale-job sweep. */
  findStaleQueued(olderThanMs: number): Promise<UploadJob[]> {
    const cutoff = new Date(Date.now() - olderThanMs);
    return this.jobRepo
      .createQueryBuilder('job')
      .where('job.status = :status', { status: 'queued' })
      .andWhere('job.created_at < :cutoff', { cutoff })
      .getMany();
  }
}
