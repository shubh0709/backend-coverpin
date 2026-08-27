import { FILING_STATUSES, FILING_TYPES } from '../entities/filing.entity';
import { ParsedSheet } from '../parsing/file-parser.service';
import { ValidationError } from './types';
import {
  isBlank,
  isFutureDate,
  isValidJurisdictionFormat,
  makeError,
  normalizeName,
  parseDate,
} from './common';
import { checkHeaderSchema } from './schema-registry';

const FILE = 'filings.csv';

export interface ParsedFilingRow {
  line: number;
  entityName: string;
  filingType: string;
  jurisdiction: string;
  filingAuthority: string | null;
  dueDate: Date;
  filedDate: Date | null;
  status: string;
}

/**
 * entityJurisdictionByName comes from the validated rows of entities.csv in
 * the same upload (Entity or FQ), keyed by normalized (trimmed, lowercased)
 * Entity Name, valued by that row's Jurisdiction — used both to check that
 * Entity Name exists and that this filing's Jurisdiction matches it.
 */
export function validateFilingsSheet(
  sheet: ParsedSheet,
  entityJurisdictionByName: Map<string, string>,
  today: Date,
): { errors: ValidationError[]; rows: ParsedFilingRow[] } {
  const errors: ValidationError[] = [];
  const err = (line: number, column: string, message: string) =>
    makeError(FILE, line, column, message);

  const colIndex = new Map(sheet.header.map((h, i) => [h, i]));
  const schemaErrors = checkHeaderSchema('filings', sheet.header);
  if (schemaErrors.length > 0) {
    return { errors: schemaErrors, rows: [] };
  }

  const get = (cells: string[], column: string) =>
    (cells[colIndex.get(column)!] ?? '').trim();

  const candidateRows: (ParsedFilingRow & { hasError: boolean })[] = [];
  const seenKeys = new Map<string, number[]>();

  for (const row of sheet.rows) {
    let hasError = false;
    const entityName = get(row.cells, 'Entity Name');
    const filingType = get(row.cells, 'Filing Type');
    const jurisdiction = get(row.cells, 'Jurisdiction');
    const filingAuthorityRaw = get(row.cells, 'Filing Authority');
    const dueDateRaw = get(row.cells, 'Due Date');
    const filedDateRaw = get(row.cells, 'Filed Date');
    const status = get(row.cells, 'Status');

    let registeredJurisdiction: string | undefined;
    if (isBlank(entityName)) {
      errors.push(err(row.line, 'Entity Name', 'Entity Name is required.'));
      hasError = true;
    } else {
      registeredJurisdiction = entityJurisdictionByName.get(
        normalizeName(entityName),
      );
      if (registeredJurisdiction === undefined) {
        errors.push(
          err(
            row.line,
            'Entity Name',
            `Entity Name '${entityName}' does not match any row in entities.csv.`,
          ),
        );
        hasError = true;
      }
    }

    if (isBlank(filingType)) {
      errors.push(err(row.line, 'Filing Type', 'Filing Type is required.'));
      hasError = true;
    } else if (!(FILING_TYPES as readonly string[]).includes(filingType)) {
      errors.push(
        err(
          row.line,
          'Filing Type',
          `Filing Type must be one of: ${FILING_TYPES.join(', ')} (got '${filingType}').`,
        ),
      );
      hasError = true;
    }

    if (isBlank(jurisdiction)) {
      errors.push(err(row.line, 'Jurisdiction', 'Jurisdiction is required.'));
      hasError = true;
    } else if (!isValidJurisdictionFormat(jurisdiction)) {
      errors.push(
        err(
          row.line,
          'Jurisdiction',
          `Jurisdiction must be 'Country' or 'Country/State' (e.g. 'United States/Delaware'), got '${jurisdiction}'.`,
        ),
      );
      hasError = true;
    } else if (
      registeredJurisdiction !== undefined &&
      jurisdiction !== registeredJurisdiction
    ) {
      errors.push(
        err(
          row.line,
          'Jurisdiction',
          `Jurisdiction '${jurisdiction}' does not match the Jurisdiction '${registeredJurisdiction}' registered for '${entityName}' in entities.csv.`,
        ),
      );
      hasError = true;
    }

    let dueDate: Date | null = null;
    if (isBlank(dueDateRaw)) {
      errors.push(err(row.line, 'Due Date', 'Due Date is required.'));
      hasError = true;
    } else {
      dueDate = parseDate(dueDateRaw) ?? null;
      if (!dueDate) {
        errors.push(
          err(
            row.line,
            'Due Date',
            `Due Date '${dueDateRaw}' is not a valid date (use YYYY-MM-DD or MM/DD/YYYY).`,
          ),
        );
        hasError = true;
      }
    }

    let statusIsValid = false;
    if (isBlank(status)) {
      errors.push(err(row.line, 'Status', 'Status is required.'));
      hasError = true;
    } else if (!(FILING_STATUSES as readonly string[]).includes(status)) {
      errors.push(
        err(
          row.line,
          'Status',
          `Status must be one of: ${FILING_STATUSES.join(', ')} (got '${status}').`,
        ),
      );
      hasError = true;
    } else {
      statusIsValid = true;
    }

    let filedDate: Date | null = null;
    if (!isBlank(filedDateRaw)) {
      filedDate = parseDate(filedDateRaw) ?? null;
      if (!filedDate) {
        errors.push(
          err(
            row.line,
            'Filed Date',
            `Filed Date '${filedDateRaw}' is not a valid date (use YYYY-MM-DD or MM/DD/YYYY).`,
          ),
        );
        hasError = true;
      } else if (isFutureDate(filedDate, today)) {
        errors.push(
          err(row.line, 'Filed Date', 'Filed Date cannot be in the future.'),
        );
        hasError = true;
      }
    }
    if (statusIsValid && status === 'Filed' && isBlank(filedDateRaw)) {
      errors.push(
        err(
          row.line,
          'Filed Date',
          `Filed Date is required when Status is 'Filed'.`,
        ),
      );
      hasError = true;
    }

    if (!isBlank(entityName) && !isBlank(filingType) && dueDate) {
      const key = `${normalizeName(entityName)}|||${filingType}|||${dueDateRaw.trim()}`;
      const lines = seenKeys.get(key) ?? [];
      lines.push(row.line);
      seenKeys.set(key, lines);
    }

    candidateRows.push({
      line: row.line,
      entityName,
      filingType,
      jurisdiction,
      filingAuthority: isBlank(filingAuthorityRaw) ? null : filingAuthorityRaw,
      dueDate: dueDate as Date,
      filedDate,
      status,
      hasError,
    });
  }

  const rowByLine = new Map(candidateRows.map((row) => [row.line, row]));
  for (const lines of seenKeys.values()) {
    if (lines.length > 1) {
      for (const line of lines) {
        const row = rowByLine.get(line)!;
        errors.push(
          err(
            line,
            'Due Date',
            `Duplicate filing row for ('${row.entityName}', '${row.filingType}', same Due Date, matching is case-insensitive on Entity Name) — appears ${lines.length} times in this file.`,
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
      entityName: row.entityName,
      filingType: row.filingType,
      jurisdiction: row.jurisdiction,
      filingAuthority: row.filingAuthority,
      dueDate: row.dueDate,
      filedDate: row.filedDate,
      status: row.status,
    }));

  return { errors, rows };
}
