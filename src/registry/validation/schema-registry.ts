import { ValidationError } from './types';
import { findMissingColumns, makeError } from './common';

export const SLOT_SCHEMAS = {
  entities: {
    file: 'entities.csv',
    requiredColumns: [
      'Entity Name',
      'Registration Type',
      'Jurisdiction',
      'Entity Type',
      'Entity Status',
      'Status Date',
      'Domestic Entity',
      'Formation Date',
      'Entity/Business ID',
      'Global Region',
    ],
  },
  ownership: {
    file: 'ownership.csv',
    requiredColumns: ['Parent Entity', 'Child Entity', 'Ownership %'],
  },
  filings: {
    file: 'filings.csv',
    requiredColumns: [
      'Entity Name',
      'Filing Type',
      'Jurisdiction',
      'Filing Authority',
      'Due Date',
      'Filed Date',
      'Status',
    ],
  },
} as const;

export type UploadSlot = keyof typeof SLOT_SCHEMAS;

/**
 * Checks an uploaded sheet's header against the schema expected for `slot`.
 * If the header is missing required columns but fully matches a *different*
 * slot's schema instead, that almost always means the wrong file was
 * dropped into this slot — so we report one targeted error instead of a
 * wall of "missing column" errors that would otherwise mask the real
 * mistake.
 */
export function checkHeaderSchema(
  slot: UploadSlot,
  header: string[],
): ValidationError[] {
  const expected = SLOT_SCHEMAS[slot];
  const missing = findMissingColumns(header, expected.requiredColumns);
  if (missing.length === 0) return [];

  const headerSet = new Set(header);
  const swappedSlot = (Object.keys(SLOT_SCHEMAS) as UploadSlot[])
    .filter((key) => key !== slot)
    .find((key) =>
      SLOT_SCHEMAS[key].requiredColumns.every((col) => headerSet.has(col)),
    );

  if (swappedSlot) {
    return [
      makeError(
        expected.file,
        1,
        'File',
        `This file's columns match ${SLOT_SCHEMAS[swappedSlot].file}, not ${expected.file}. Check that you selected the right file for the ${slot} slot.`,
      ),
    ];
  }

  return missing.map((column) =>
    makeError(expected.file, 1, column, `Missing required column '${column}'.`),
  );
}
