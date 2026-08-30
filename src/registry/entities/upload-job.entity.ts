import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const UPLOAD_JOB_STATUSES = [
  'queued',
  'processing',
  'completed',
  'failed',
] as const;
export type UploadJobStatus = (typeof UPLOAD_JOB_STATUSES)[number];

export const UPLOAD_JOB_DISPATCH_METHODS = [
  'qstash',
  'local-fallback',
] as const;
export type UploadJobDispatchMethod =
  (typeof UPLOAD_JOB_DISPATCH_METHODS)[number];

/** One POST /upload/async call — the parsed+validated rows (`payload`) are
 * persisted here so a QStash callback (which only carries the job id, not
 * the original files) or the local-fallback worker thread can load them and
 * write them to entities/ownership_edges/filings without re-parsing. */
@Entity({ name: 'upload_jobs' })
export class UploadJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', default: 'queued' })
  status: UploadJobStatus;

  @Column({ name: 'dispatch_method', type: 'text', nullable: true })
  dispatchMethod: UploadJobDispatchMethod | null;

  @Column({ type: 'jsonb' })
  payload: unknown;

  @Column({ type: 'jsonb', nullable: true })
  result: unknown;

  @Column({ type: 'jsonb', nullable: true })
  error: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
