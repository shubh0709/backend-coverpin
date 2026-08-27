import { ValidationError } from './types';

export function makeError(
  file: string,
  line: number,
  column: string,
  message: string,
): ValidationError {
  return { file, line, column, message };
}

export function isBlank(value: string): boolean {
  return value.trim() === '';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const US_DATE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

/** Accepts YYYY-MM-DD or MM/DD/YYYY, both interpreted as UTC calendar dates. */
export function parseDate(raw: string): Date | undefined {
  const value = raw.trim();

  if (ISO_DATE.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() !== y ||
      date.getUTCMonth() !== m - 1 ||
      date.getUTCDate() !== d
    ) {
      return undefined;
    }
    return date;
  }

  if (US_DATE.test(value)) {
    const [m, d, y] = value.split('/').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() !== y ||
      date.getUTCMonth() !== m - 1 ||
      date.getUTCDate() !== d
    ) {
      return undefined;
    }
    return date;
  }

  return undefined;
}

export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isFutureDate(date: Date, today: Date): boolean {
  return toDateOnlyString(date) > toDateOnlyString(today);
}

/** 'Country' or 'Country/State' — non-empty segments either side of at most one '/'. */
export function isValidJurisdictionFormat(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  const parts = trimmed.split('/');
  if (parts.length > 2) return false;
  return parts.every((part) => part.trim() !== '');
}

export function findMissingColumns(
  header: string[],
  required: readonly string[],
): string[] {
  const present = new Set(header);
  return required.filter((column) => !present.has(column));
}
