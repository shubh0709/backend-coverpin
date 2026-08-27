import {
  computeComplianceStatus,
  computeNextDueDate,
  daysBetween,
} from './compliance.util';

const TODAY = new Date(Date.UTC(2026, 7, 27)); // 2026-08-27

function daysFromToday(offset: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

describe('computeNextDueDate', () => {
  it('returns null when there are no filings', () => {
    expect(computeNextDueDate([])).toBeNull();
  });

  it('returns null when every filing is Filed or Canceled', () => {
    const result = computeNextDueDate([
      { dueDate: daysFromToday(10), status: 'Filed' },
      { dueDate: daysFromToday(20), status: 'Canceled' },
    ]);
    expect(result).toBeNull();
  });

  it('picks the earliest due date among eligible filings, ignoring Filed/Canceled', () => {
    const earliest = daysFromToday(5);
    const result = computeNextDueDate([
      { dueDate: daysFromToday(1), status: 'Filed' },
      { dueDate: earliest, status: 'Not Started' },
      { dueDate: daysFromToday(30), status: 'In Progress' },
      { dueDate: daysFromToday(2), status: 'Canceled' },
    ]);
    expect(result).toEqual(earliest);
  });

  it('treats Rejected and Submitted as eligible', () => {
    const earliest = daysFromToday(3);
    const result = computeNextDueDate([
      { dueDate: earliest, status: 'Rejected' },
      { dueDate: daysFromToday(9), status: 'Submitted' },
    ]);
    expect(result).toEqual(earliest);
  });
});

describe('daysBetween', () => {
  it('is positive when `to` is in the future', () => {
    expect(daysBetween(TODAY, daysFromToday(10))).toBe(10);
  });

  it('is negative when `to` is in the past', () => {
    expect(daysBetween(TODAY, daysFromToday(-10))).toBe(-10);
  });

  it('is zero for the same day', () => {
    expect(daysBetween(TODAY, TODAY)).toBe(0);
  });
});

describe('computeComplianceStatus', () => {
  it('returns NOT_APPLICABLE for every terminal entity status, regardless of due date', () => {
    const terminalStatuses = [
      'Revoked/Terminated',
      'Merged/Acquired',
      'Divested/Sold',
      'Dormant',
      'Dissolved',
    ];
    for (const status of terminalStatuses) {
      expect(computeComplianceStatus(status, daysFromToday(-1000), TODAY)).toBe(
        'NOT_APPLICABLE',
      );
      expect(computeComplianceStatus(status, null, TODAY)).toBe(
        'NOT_APPLICABLE',
      );
    }
  });

  it("the brief's own worked example: a Dissolved entity two years overdue is NOT_APPLICABLE, not SUSPENDED", () => {
    expect(
      computeComplianceStatus('Dissolved', daysFromToday(-730), TODAY),
    ).toBe('NOT_APPLICABLE');
  });

  it('returns TBD when entity status is non-terminal and there is no next due date', () => {
    expect(computeComplianceStatus('Active', null, TODAY)).toBe('TBD');
    expect(computeComplianceStatus('In Formation', null, TODAY)).toBe('TBD');
  });

  it('returns GOOD_STANDING at and above the d >= 90 boundary', () => {
    expect(computeComplianceStatus('Active', daysFromToday(90), TODAY)).toBe(
      'GOOD_STANDING',
    );
    expect(computeComplianceStatus('Active', daysFromToday(91), TODAY)).toBe(
      'GOOD_STANDING',
    );
    expect(computeComplianceStatus('Active', daysFromToday(1000), TODAY)).toBe(
      'GOOD_STANDING',
    );
  });

  it('returns FILING_DUE for 0 <= d < 90, including both boundaries', () => {
    expect(computeComplianceStatus('Active', daysFromToday(0), TODAY)).toBe(
      'FILING_DUE',
    );
    expect(computeComplianceStatus('Active', daysFromToday(89), TODAY)).toBe(
      'FILING_DUE',
    );
  });

  it('returns OVERDUE for -364 <= d < 0, including both boundaries', () => {
    expect(computeComplianceStatus('Active', daysFromToday(-1), TODAY)).toBe(
      'OVERDUE',
    );
    expect(computeComplianceStatus('Active', daysFromToday(-364), TODAY)).toBe(
      'OVERDUE',
    );
  });

  it('returns SUSPENDED for d < -364', () => {
    expect(computeComplianceStatus('Active', daysFromToday(-365), TODAY)).toBe(
      'SUSPENDED',
    );
    expect(computeComplianceStatus('Active', daysFromToday(-2000), TODAY)).toBe(
      'SUSPENDED',
    );
  });
});
