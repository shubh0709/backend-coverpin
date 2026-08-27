export type ComplianceStatus =
  | 'NOT_APPLICABLE'
  | 'TBD'
  | 'GOOD_STANDING'
  | 'FILING_DUE'
  | 'OVERDUE'
  | 'SUSPENDED';

const TERMINAL_ENTITY_STATUSES: ReadonlySet<string> = new Set([
  'Revoked/Terminated',
  'Merged/Acquired',
  'Divested/Sold',
  'Dormant',
  'Dissolved',
]);

const INELIGIBLE_FILING_STATUSES: ReadonlySet<string> = new Set([
  'Filed',
  'Canceled',
]);

export interface FilingForDueDate {
  dueDate: Date;
  status: string;
}

/** Calendar-day difference from `from` to `to` (UTC, DST/timezone-safe), positive if `to` is later. */
export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toUtc - fromUtc) / MS_PER_DAY);
}

/** Earliest Due Date among filings not Filed and not Canceled, or null if none. */
export function computeNextDueDate(filings: FilingForDueDate[]): Date | null {
  const eligible = filings.filter(
    (f) => !INELIGIBLE_FILING_STATUSES.has(f.status),
  );
  if (eligible.length === 0) return null;
  return eligible.reduce(
    (earliest, f) => (f.dueDate < earliest ? f.dueDate : earliest),
    eligible[0].dueDate,
  );
}

/**
 * The compliance-status ladder from the brief. Entity Status is checked
 * first and wins outright, regardless of how overdue the next filing is.
 */
export function computeComplianceStatus(
  entityStatus: string,
  nextDueDate: Date | null,
  today: Date,
): ComplianceStatus {
  if (TERMINAL_ENTITY_STATUSES.has(entityStatus)) return 'NOT_APPLICABLE';
  if (!nextDueDate) return 'TBD';

  const d = daysBetween(today, nextDueDate);
  if (d >= 90) return 'GOOD_STANDING';
  if (d >= 0) return 'FILING_DUE';
  if (d >= -364) return 'OVERDUE';
  return 'SUSPENDED';
}
