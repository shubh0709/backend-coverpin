import { ParsedSheet } from '../parsing/file-parser.service';
import { ValidationError } from './types';
import { isBlank, makeError, normalizeName } from './common';
import { checkHeaderSchema } from './schema-registry';

const FILE = 'ownership.csv';
const PCT_FORMAT = /^\d+(\.\d{1,2})?$/;

export interface ParsedOwnershipRow {
  line: number;
  parentEntity: string;
  childEntity: string;
  ownershipPct: number;
}

/**
 * entityTypeByName comes from the validated rows of entities.csv in the same
 * upload, keyed by normalized (trimmed, lowercased) Entity Name — matching
 * is case-insensitive everywhere Entity Name is compared.
 */
export function validateOwnershipSheet(
  sheet: ParsedSheet,
  entityTypeByName: Map<string, 'Entity' | 'FQ'>,
): { errors: ValidationError[]; rows: ParsedOwnershipRow[] } {
  const errors: ValidationError[] = [];
  const err = (line: number, column: string, message: string) =>
    makeError(FILE, line, column, message);

  const colIndex = new Map(sheet.header.map((h, i) => [h, i]));
  const schemaErrors = checkHeaderSchema('ownership', sheet.header);
  if (schemaErrors.length > 0) {
    return { errors: schemaErrors, rows: [] };
  }

  const get = (cells: string[], column: string) =>
    (cells[colIndex.get(column)!] ?? '').trim();

  const candidateRows: (ParsedOwnershipRow & { hasError: boolean })[] = [];
  const seenPairs = new Map<string, number[]>();

  for (const row of sheet.rows) {
    let hasError = false;
    const parentEntity = get(row.cells, 'Parent Entity');
    const childEntity = get(row.cells, 'Child Entity');
    const pctRaw = get(row.cells, 'Ownership %');

    if (isBlank(parentEntity)) {
      errors.push(err(row.line, 'Parent Entity', 'Parent Entity is required.'));
      hasError = true;
    } else if (!entityTypeByName.has(normalizeName(parentEntity))) {
      errors.push(
        err(
          row.line,
          'Parent Entity',
          `Parent Entity '${parentEntity}' does not match any Entity Name in entities.csv.`,
        ),
      );
      hasError = true;
    } else if (entityTypeByName.get(normalizeName(parentEntity)) === 'FQ') {
      errors.push(
        err(
          row.line,
          'Parent Entity',
          `Parent Entity '${parentEntity}' is a Foreign Qualification (FQ); an FQ cannot own other entities.`,
        ),
      );
      hasError = true;
    }

    if (isBlank(childEntity)) {
      errors.push(err(row.line, 'Child Entity', 'Child Entity is required.'));
      hasError = true;
    } else if (!entityTypeByName.has(normalizeName(childEntity))) {
      errors.push(
        err(
          row.line,
          'Child Entity',
          `Child Entity '${childEntity}' does not match any Entity Name in entities.csv.`,
        ),
      );
      hasError = true;
    } else if (entityTypeByName.get(normalizeName(childEntity)) === 'FQ') {
      errors.push(
        err(
          row.line,
          'Child Entity',
          `Child Entity '${childEntity}' is a Foreign Qualification (FQ); an FQ can never be a Child Entity.`,
        ),
      );
      hasError = true;
    }

    if (
      !isBlank(parentEntity) &&
      !isBlank(childEntity) &&
      normalizeName(parentEntity) === normalizeName(childEntity)
    ) {
      errors.push(
        err(
          row.line,
          'Child Entity',
          `Parent Entity and Child Entity cannot be the same entity ('${parentEntity}').`,
        ),
      );
      hasError = true;
    }

    let ownershipPct = 0;
    if (isBlank(pctRaw)) {
      errors.push(err(row.line, 'Ownership %', 'Ownership % is required.'));
      hasError = true;
    } else if (!PCT_FORMAT.test(pctRaw)) {
      errors.push(
        err(
          row.line,
          'Ownership %',
          `Ownership % '${pctRaw}' must be a positive number with at most 2 decimal places.`,
        ),
      );
      hasError = true;
    } else {
      ownershipPct = Number(pctRaw);
      if (!(ownershipPct > 0 && ownershipPct <= 100)) {
        errors.push(
          err(
            row.line,
            'Ownership %',
            `Ownership % must be greater than 0 and at most 100 (got ${ownershipPct}).`,
          ),
        );
        hasError = true;
      }
    }

    if (
      !isBlank(parentEntity) &&
      !isBlank(childEntity) &&
      normalizeName(parentEntity) !== normalizeName(childEntity)
    ) {
      const key = `${normalizeName(parentEntity)}|||${normalizeName(childEntity)}`;
      const lines = seenPairs.get(key) ?? [];
      lines.push(row.line);
      seenPairs.set(key, lines);
    }

    candidateRows.push({
      line: row.line,
      parentEntity,
      childEntity,
      ownershipPct,
      hasError,
    });
  }

  const rowByLine = new Map(candidateRows.map((row) => [row.line, row]));
  for (const lines of seenPairs.values()) {
    if (lines.length > 1) {
      for (const line of lines) {
        const row = rowByLine.get(line)!;
        errors.push(
          err(
            line,
            'Parent Entity',
            `Duplicate ownership row for ('${row.parentEntity}' -> '${row.childEntity}', matching is case-insensitive) — appears ${lines.length} times in this file.`,
          ),
        );
      }
    }
  }

  const erroredLines = new Set(errors.map((e) => e.line));
  const rows = candidateRows
    .filter((row) => !row.hasError && !erroredLines.has(row.line))
    .map((row) => ({
      line: row.line,
      parentEntity: row.parentEntity,
      childEntity: row.childEntity,
      ownershipPct: row.ownershipPct,
    }));

  return { errors, rows };
}
