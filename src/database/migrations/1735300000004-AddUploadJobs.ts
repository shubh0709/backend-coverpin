import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backs POST /upload/async (see UploadAsyncController): a job row is created
 * with the parsed+validated rows in `payload` before dispatch, so either the
 * QStash callback or the local-fallback worker thread can load them by id
 * alone and write them without re-parsing the original files.
 */
export class AddUploadJobs1735300000004 implements MigrationInterface {
  name = 'AddUploadJobs1735300000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "upload_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "status" text NOT NULL DEFAULT 'queued' CHECK ("status" IN (
          'queued','processing','completed','failed')),
        "dispatch_method" text CHECK ("dispatch_method" IN ('qstash','local-fallback')),
        "payload" jsonb NOT NULL,
        "result" jsonb,
        "error" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);

    // Backs the reconciliation sweep: jobs still 'queued' past a staleness
    // threshold (see UploadReconciliationService).
    await queryRunner.query(`
      CREATE INDEX "idx_upload_jobs_status_created_at"
        ON "upload_jobs" ("status", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "upload_jobs";`);
  }
}
