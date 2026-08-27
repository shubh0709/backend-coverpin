import { validateOwnershipGraph } from './graph-validator';
import { ParsedOwnershipRow } from './ownership-validator';

function row(
  line: number,
  parentEntity: string,
  childEntity: string,
  ownershipPct: number,
): ParsedOwnershipRow {
  return { line, parentEntity, childEntity, ownershipPct };
}

describe('validateOwnershipGraph', () => {
  it('produces no errors for a simple valid DAG', () => {
    const rows = [row(2, 'A', 'B', 70), row(3, 'A', 'C', 25)];
    expect(validateOwnershipGraph(rows, [])).toEqual([]);
  });

  it('detects a direct two-node cycle and flags both rows', () => {
    const rows = [row(2, 'A', 'B', 50), row(3, 'B', 'A', 50)];
    const errors = validateOwnershipGraph(rows, []);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.line).sort()).toEqual([2, 3]);
    expect(errors.every((e) => e.message.includes('cycle'))).toBe(true);
  });

  it('detects a longer cycle spanning more than two rows', () => {
    const rows = [
      row(2, 'A', 'B', 50),
      row(3, 'B', 'C', 50),
      row(4, 'C', 'A', 50),
    ];
    const errors = validateOwnershipGraph(rows, []);
    expect(errors.map((e) => e.line).sort()).toEqual([2, 3, 4]);
  });

  it('detects a cycle formed only when merged with already-persisted edges', () => {
    // DB already has C -> A. This upload adds A -> B -> C, closing the cycle.
    const rows = [row(2, 'A', 'B', 100), row(3, 'B', 'C', 100)];
    const existing = [{ parentName: 'C', childName: 'A', pct: 100 }];
    const errors = validateOwnershipGraph(rows, existing);
    // Only rows present in *this* upload can carry a line-numbered error.
    expect(errors.map((e) => e.line).sort()).toEqual([2, 3]);
  });

  it('does not flag unrelated rows outside the cycle', () => {
    const rows = [
      row(2, 'A', 'B', 50),
      row(3, 'B', 'A', 50),
      row(4, 'X', 'Y', 100),
    ];
    const errors = validateOwnershipGraph(rows, []);
    expect(errors.some((e) => e.line === 4)).toBe(false);
  });

  it('flags a child whose total ownership across parents exceeds 100%', () => {
    const rows = [row(2, 'A', 'C', 60), row(3, 'B', 'C', 60)];
    const errors = validateOwnershipGraph(rows, []);
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.message.includes('120.00%'))).toBe(true);
  });

  it('allows totals under or equal to 100%', () => {
    const rows = [row(2, 'A', 'C', 60), row(3, 'B', 'C', 40)];
    expect(validateOwnershipGraph(rows, [])).toEqual([]);
  });

  it('sums this upload against existing persisted ownership of the same child', () => {
    const rows = [row(2, 'B', 'C', 50)];
    const existing = [{ parentName: 'A', childName: 'C', pct: 60 }];
    const errors = validateOwnershipGraph(rows, existing);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
    expect(errors[0].message).toContain('110.00%');
  });

  it('an upsert that lowers an existing edge no longer over-counts the old value', () => {
    // DB has A -> C at 90%. This upload updates A -> C to 50% and adds B -> C at 40%: total 90%, fine.
    const rows = [row(2, 'A', 'C', 50), row(3, 'B', 'C', 40)];
    const existing = [{ parentName: 'A', childName: 'C', pct: 90 }];
    expect(validateOwnershipGraph(rows, existing)).toEqual([]);
  });
});
