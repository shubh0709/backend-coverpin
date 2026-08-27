import { fuzzyMatchScore, levenshtein } from './fuzzy-match';

describe('levenshtein', () => {
  it('is 0 for identical strings', () => {
    expect(levenshtein('acme', 'acme')).toBe(0);
  });

  it('counts a single substitution', () => {
    expect(levenshtein('acme', 'acmo')).toBe(1);
  });

  it('counts insertions and deletions', () => {
    expect(levenshtein('acme', 'acmee')).toBe(1);
    expect(levenshtein('acme', 'acm')).toBe(1);
  });

  it('counts an adjacent transposition as a single edit', () => {
    expect(levenshtein('acme', 'acem')).toBe(1);
  });
});

describe('fuzzyMatchScore', () => {
  it('scores a direct substring match as 0', () => {
    expect(fuzzyMatchScore('acme', 'Acme Holdings LLC')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatchScore('ACME', 'acme holdings llc')).toBe(0);
  });

  it('ranks a closer typo above a more distant one', () => {
    const exact = fuzzyMatchScore('Acme Corp', 'Acme Corp Holdings'); // substring
    const oneEdit = fuzzyMatchScore('Acne', 'Acme Holdings LLC'); // 1 substitution
    const threeEdits = fuzzyMatchScore('Axyz', 'Acme Holdings LLC'); // 3 substitutions
    expect(exact).toBe(0);
    expect(oneEdit).toBe(1);
    expect(threeEdits).toBeNull(); // beyond the length-4 tolerance of 1
    expect(oneEdit!).toBeLessThan(2);
  });

  it('matches a single mistyped word inside a longer name', () => {
    expect(fuzzyMatchScore('Acne', 'Acme Global Holdings Inc')).toBe(1);
  });

  it('rejects unrelated names', () => {
    expect(fuzzyMatchScore('Acme', 'Northwind Trading Co')).toBeNull();
  });

  it('requires an exact substring for very short queries', () => {
    // Length <= 2 gets zero tolerance — otherwise almost anything is a
    // 1-edit match and the search becomes useless.
    expect(fuzzyMatchScore('ab', 'xy')).toBeNull();
    expect(fuzzyMatchScore('ab', 'ab holdings')).toBe(0);
  });

  it('returns null for a blank query', () => {
    expect(fuzzyMatchScore('   ', 'Acme Holdings LLC')).toBeNull();
  });
});
