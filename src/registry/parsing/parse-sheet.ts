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

/** Thrown by parseSheetSync on a structural parse failure. Deliberately a
 * plain object (not an Error subclass) so it survives worker_threads'
 * structured-clone postMessage boundary without special handling. */
export interface ParseFailure {
  validationError: ValidationError;
}

export function isParseFailure(e: unknown): e is ParseFailure {
  return (
    typeof e === 'object' &&
    e !== null &&
    'validationError' in e &&
    typeof (e as ParseFailure).validationError === 'object'
  );
}

/**
 * Parses a .csv or single-sheet .xlsx buffer into a header + line-numbered
 * rows. Runs on Node's main thread if called directly, or inside a worker
 * thread via file-parser.worker.ts — kept dependency-free of Nest/DI so
 * either caller can use it.
 *
 * `slotFile` is the fixed logical filename (e.g. 'entities.csv') this upload
 * slot is validated against, used as the `file` field on any structural
 * error — independent of whatever the user actually named their file.
 */
export function parseSheetSync(
  buffer: Buffer,
  originalname: string,
  slotFile: string,
): ParsedSheet {
  const name = originalname.toLowerCase();
  let matrix: string[][];

  if (name.endsWith('.xlsx')) {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw {
          validationError: makeError(
            slotFile,
            1,
            'File',
            `'${originalname}' is an .xlsx workbook with no sheets.`,
          ),
        };
      }
      const sheet = workbook.Sheets[sheetName];
      matrix = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: '',
      });
    } catch (e) {
      if (isParseFailure(e)) throw e;
      throw {
        validationError: makeError(
          slotFile,
          1,
          'File',
          `'${originalname}' could not be read — it may be corrupt or not a valid .xlsx file.`,
        ),
      };
    }
  } else if (name.endsWith('.csv')) {
    try {
      matrix = parse(buffer, {
        skip_empty_lines: false,
        relax_column_count: true,
      }) as string[][];
    } catch {
      throw {
        validationError: makeError(
          slotFile,
          1,
          'File',
          `'${originalname}' could not be read — it may be corrupt or not a valid CSV file.`,
        ),
      };
    }
  } else {
    throw {
      validationError: makeError(
        slotFile,
        1,
        'File',
        `Unsupported file type for '${originalname}'. Use .csv or .xlsx.`,
      ),
    };
  }

  if (matrix.length === 0) {
    throw {
      validationError: makeError(
        slotFile,
        1,
        'File',
        `'${originalname}' is empty.`,
      ),
    };
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
