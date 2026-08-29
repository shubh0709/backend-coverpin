import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { ValidationError } from '../validation/types';
import { ParsedRow, ParsedSheet } from './parse-sheet';

export type { ParsedRow, ParsedSheet };

/**
 * A structural-level parse failure (unsupported format, corrupt/unreadable
 * file, empty file, header missing/unrecognizable) — carries a
 * ValidationError in the exact same {file, line, column, message} shape as
 * every other validation error, so it can be merged into the same 422
 * response rather than surfacing as a generic 400/500.
 */
export class FileParseError extends Error {
  constructor(public readonly validationError: ValidationError) {
    super(validationError.message);
    this.name = 'FileParseError';
  }
}

type WorkerResult =
  | { ok: true; sheet: ParsedSheet }
  | { ok: false; validationError: ValidationError };

/** Parses an uploaded .csv or single-sheet .xlsx into a header + line-numbered
 * rows. Runs off the main thread (via worker_threads) since XLSX/CSV parsing
 * is synchronous and CPU-bound — without this, a large upload would block
 * the event loop and stall every other in-flight request on the process. */
@Injectable()
export class FileParserService {
  parse(file: Express.Multer.File, slotFile: string): Promise<ParsedSheet> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'file-parser.worker.js'), {
        workerData: {
          buffer: file.buffer,
          originalname: file.originalname,
          slotFile,
        },
      });

      worker.once('message', (result: WorkerResult) => {
        if (result.ok) {
          resolve(result.sheet);
        } else {
          reject(new FileParseError(result.validationError));
        }
      });

      worker.once('error', (err) => reject(err));

      worker.once('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`File parser worker stopped with exit code ${code}`));
        }
      });
    });
  }
}
