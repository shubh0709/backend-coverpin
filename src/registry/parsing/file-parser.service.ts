import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { ValidationError } from '../validation/types';
import { makeError } from '../validation/common';

export interface ParsedRow {
  /** Spreadsheet-native line number: header = 1, first data row = 2. */
  line: number;
  cells: string[];
}

export interface ParsedSheet {
  header: string[];
  rows: ParsedRow[];
}

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

/** Parses an uploaded .csv or single-sheet .xlsx into a header + line-numbered rows. */
@Injectable()
export class FileParserService {
  /** `slotFile` is the fixed logical filename (e.g. 'entities.csv') this upload
   * slot is validated against, used as the `file` field on any structural
   * error — independent of whatever the user actually named their file. */
  parse(file: Express.Multer.File, slotFile: string): ParsedSheet {
    const name = file.originalname.toLowerCase();
    let matrix: string[][];

    if (name.endsWith('.xlsx')) {
      try {
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          throw new FileParseError(
            makeError(
              slotFile,
              1,
              'File',
              `'${file.originalname}' is an .xlsx workbook with no sheets.`,
            ),
          );
        }
        const sheet = workbook.Sheets[sheetName];
        matrix = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
          defval: '',
        });
      } catch (e) {
        if (e instanceof FileParseError) throw e;
        throw new FileParseError(
          makeError(
            slotFile,
            1,
            'File',
            `'${file.originalname}' could not be read — it may be corrupt or not a valid .xlsx file.`,
          ),
        );
      }
    } else if (name.endsWith('.csv')) {
      try {
        matrix = parse(file.buffer, {
          skip_empty_lines: false,
          relax_column_count: true,
        }) as string[][];
      } catch {
        throw new FileParseError(
          makeError(
            slotFile,
            1,
            'File',
            `'${file.originalname}' could not be read — it may be corrupt or not a valid CSV file.`,
          ),
        );
      }
    } else {
      throw new FileParseError(
        makeError(
          slotFile,
          1,
          'File',
          `Unsupported file type for '${file.originalname}'. Use .csv or .xlsx.`,
        ),
      );
    }

    if (matrix.length === 0) {
      throw new FileParseError(
        makeError(slotFile, 1, 'File', `'${file.originalname}' is empty.`),
      );
    }

    const header = matrix[0].map((cell) => (cell ?? '').toString().trim());
    const rows: ParsedRow[] = matrix
      .slice(1)
      .map((cells, idx) => ({
        line: idx + 2,
        cells: cells.map((cell) => (cell ?? '').toString()),
      }))
      .filter((row) => row.cells.some((cell) => cell.trim() !== ''));

    return { header, rows };
  }
}
