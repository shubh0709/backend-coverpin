import { BadRequestException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

export interface ParsedRow {
  /** Spreadsheet-native line number: header = 1, first data row = 2. */
  line: number;
  cells: string[];
}

export interface ParsedSheet {
  header: string[];
  rows: ParsedRow[];
}

/** Parses an uploaded .csv or single-sheet .xlsx into a header + line-numbered rows. */
@Injectable()
export class FileParserService {
  parse(file: Express.Multer.File): ParsedSheet {
    const name = file.originalname.toLowerCase();
    let matrix: string[][];

    if (name.endsWith('.xlsx')) {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      matrix = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: '',
      });
    } else if (name.endsWith('.csv')) {
      matrix = parse(file.buffer, {
        skip_empty_lines: false,
        relax_column_count: true,
      }) as string[][];
    } else {
      throw new BadRequestException(
        `Unsupported file type for '${file.originalname}'. Use .csv or .xlsx.`,
      );
    }

    if (matrix.length === 0) {
      throw new BadRequestException(`'${file.originalname}' is empty.`);
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
