import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Receiver } from '@upstash/qstash';
import { ValidationService } from './validation/validation.service';
import { RegistryService } from './registry.service';
import { QueueDispatchService } from './queue-dispatch.service';
import { UploadJobsService } from './upload-jobs.service';
import {
  toUploadBatchRows,
  UploadBatchRows,
  writeUploadBatch,
} from './upload-writer';

interface UploadFileFields {
  entities?: Express.Multer.File[];
  ownership?: Express.Multer.File[];
  filings?: Express.Multer.File[];
}

// Same env-read-before-DI timing constraint as upload.controller.ts.
const MAX_FILE_SIZE_BYTES =
  Number(process.env.MAX_UPLOAD_FILE_SIZE_BYTES) || 10 * 1024 * 1024;

/**
 * Demo of a QStash-primary / worker_threads-fallback async job, additive to
 * (and independent of) the synchronous POST /upload — see the plan this was
 * built from for the full design rationale. Same file inputs and validation
 * as /upload, but the actual DB write is deferred to a job:
 *  - primary: publish to QStash, which POSTs back to /upload/async/callback
 *    (an inbound request, so it also wakes a sleeping Render instance)
 *  - fallback: if publishing fails, run the write immediately via
 *    upload-writer.worker.ts (worker_threads), same pattern
 *    file-parser.service.ts already uses for CPU-bound parsing. A stale-job
 *    sweep (UploadReconciliationService) also uses this fallback for the
 *    rarer case where QStash accepted the publish but never delivered it.
 *
 * Whichever path reaches a job first atomically claims it
 * (queued -> processing, via UploadJobsService.claim's conditional UPDATE)
 * so a late QStash delivery racing an already-finished fallback run is a
 * no-op, not a double-write.
 */
@ApiTags('upload')
@Controller('upload/async')
export class UploadAsyncController {
  constructor(
    private readonly validationService: ValidationService,
    private readonly registryService: RegistryService,
    private readonly queueDispatchService: QueueDispatchService,
    private readonly uploadJobsService: UploadJobsService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Same 3 files as POST /upload, but writes them as a background job instead of inline.',
    description: `Validates synchronously (same 422 on a bad batch as /upload) but, once valid, returns
immediately with a job id instead of writing inline. The write itself happens via QStash
(preferred) or, if QStash publish fails, via an in-process worker thread. Poll
GET /upload/async/{jobId} for the outcome.`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['entities', 'ownership', 'filings'],
      properties: {
        entities: { type: 'string', format: 'binary' },
        ownership: { type: 'string', format: 'binary' },
        filings: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Batch validated; write dispatched as a background job.',
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'entities', maxCount: 1 },
        { name: 'ownership', maxCount: 1 },
        { name: 'filings', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_FILE_SIZE_BYTES } },
    ),
  )
  async upload(@UploadedFiles() files: UploadFileFields) {
    const entities = files?.entities?.[0];
    const ownership = files?.ownership?.[0];
    const filings = files?.filings?.[0];

    const validated = await this.validationService.validateUpload({
      entities,
      ownership,
      filings,
    });
    if (validated.errors.length > 0) {
      throw new UnprocessableEntityException({ errors: validated.errors });
    }

    const payload = toUploadBatchRows(validated);
    const job = await this.uploadJobsService.create(payload);

    const published = await this.queueDispatchService.publish(job.id);
    await this.uploadJobsService.setDispatchMethod(
      job.id,
      published ? 'qstash' : 'local-fallback',
    );
    if (!published) {
      // Fire-and-forget: the response shouldn't wait on this, and its
      // outcome is picked up by polling GET /upload/async/:jobId.
      void this.queueDispatchService.runFallback(job);
    }

    return {
      jobId: job.id,
      status: 'queued',
      dispatchMethod: published ? 'qstash' : 'local-fallback',
    };
  }

  @Post('callback')
  @HttpCode(200)
  @ApiOperation({
    summary: 'QStash calls this back to actually run a queued job.',
    description:
      'Not meant to be called directly — verified via the Upstash-Signature header. Always ' +
      '200s (including on a job-processing failure) so QStash does not endlessly retry a ' +
      'batch that failed for a reason retrying will not fix; failures are recorded on the ' +
      "job (see GET /upload/async/{jobId}) rather than surfaced as this route's response.",
  })
  @ApiOkResponse({
    description: 'Acknowledged (job processed or already handled).',
  })
  async callback(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: { jobId: string },
  ) {
    await this.verifyQStashSignature(req);

    const job = await this.uploadJobsService.findById(body.jobId);
    // Unknown or already-claimed (e.g. the local fallback beat this
    // delivery, or QStash retried after an earlier delivery succeeded) --
    // both are no-ops, not errors, so QStash doesn't retry a dead job.
    if (!job || job.status !== 'queued') {
      return { ok: true };
    }
    if (!(await this.uploadJobsService.claim(job.id))) {
      return { ok: true };
    }

    try {
      const rows = job.payload as UploadBatchRows;
      const chunkSize = this.configService.get<number>(
        'limits.uploadBatchChunkSize',
      )!;
      const result = await this.dataSource.transaction((manager) =>
        writeUploadBatch(rows, manager, chunkSize),
      );
      this.registryService.invalidateAnalyticsCache();
      await this.uploadJobsService.markCompleted(job.id, result);
    } catch (e) {
      await this.uploadJobsService.markFailed(
        job.id,
        e instanceof Error ? e.message : String(e),
      );
    }

    return { ok: true };
  }

  @Get(':jobId')
  @ApiOperation({ summary: 'Poll the status/outcome of a /upload/async job.' })
  async getStatus(@Param('jobId') jobId: string) {
    const job = await this.uploadJobsService.findById(jobId);
    if (!job) throw new NotFoundException(`No job '${jobId}'.`);
    return {
      jobId: job.id,
      status: job.status,
      dispatchMethod: job.dispatchMethod,
      result: job.result,
      error: job.error,
    };
  }

  /** No-op (signature check skipped) when signing keys aren't configured --
   * matches QueueDispatchService.publish's "QStash not configured" fallback,
   * so local dev without QStash env vars never reaches this route for real
   * anyway (nothing is ever published to call it back). */
  private async verifyQStashSignature(req: RawBodyRequest<Request>) {
    const currentSigningKey = this.configService.get<string>(
      'queue.qstashCurrentSigningKey',
    );
    const nextSigningKey = this.configService.get<string>(
      'queue.qstashNextSigningKey',
    );
    if (!currentSigningKey || !nextSigningKey) return;

    const signature = req.headers['upstash-signature'];
    const rawBody = req.rawBody?.toString('utf8') ?? '';
    const receiver = new Receiver({ currentSigningKey, nextSigningKey });
    const valid = await receiver
      .verify({ signature: signature as string, body: rawBody })
      .catch(() => false);
    if (!valid) {
      throw new UnauthorizedException('Invalid QStash signature.');
    }
  }
}
