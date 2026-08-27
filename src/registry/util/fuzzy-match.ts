/** Damerau-Levenshtein edit distance (restricted/OSA variant): insert,
 * delete, substitute, or transpose two adjacent characters, each cost 1.
 * Transposition is included because swapped-adjacent-letter typos (e.g.
 * "hte" for "the") are among the most common ways users mistype a word. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from(
    { length: rows },
    () => new Array<number>(cols),
  );

  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }

  return d[rows - 1][cols - 1];
}

/** How many typos to tolerate for a query of a given length — mirrors
 * Elasticsearch's "AUTO" fuzziness: too short and almost anything is within
 * 1 edit, so short queries require an exact (substring) hit. */
function maxEditDistance(queryLength: number): number {
  if (queryLength <= 2) return 0;
  if (queryLength <= 5) return 1;
  return 2;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Scores how well `term` matches `text`, for typo-tolerant search.
 *
 * Returns 0 for a direct substring match, a positive edit distance for a
 * fuzzy (typo'd) match, or null if `text` isn't a plausible match at all.
 * Lower is a better match, so results can be ranked with the closest match
 * first instead of only doing a binary include/exclude.
 */
export function fuzzyMatchScore(term: string, text: string): number | null {
  const needle = term.trim().toLowerCase();
  if (!needle) return null;
  const haystack = text.toLowerCase();

  if (haystack.includes(needle)) return 0;

  const threshold = maxEditDistance(needle.length);
  if (threshold === 0) return null;

  let best = Infinity;

  // Whole-string comparison catches typos in short entity names.
  if (Math.abs(haystack.length - needle.length) <= threshold) {
    best = Math.min(best, levenshtein(needle, haystack));
  }

  // Per-word comparison catches a typo confined to one word inside a longer
  // name, e.g. "Acem Holdings" fuzzy-matching "Acme Holdings LLC".
  for (const word of tokenize(haystack)) {
    if (Math.abs(word.length - needle.length) > threshold) continue;
    best = Math.min(best, levenshtein(needle, word));
    if (best === 0) break;
  }

  // Sliding window over the raw haystack catches a typo'd multi-word
  // phrase, e.g. "Acme Corp" fuzzy-matching inside "Acme Corportion Intl".
  if (best > 0 && needle.length >= 3) {
    for (let i = 0; i + needle.length <= haystack.length; i++) {
      const window = haystack.slice(i, i + needle.length);
      const d = levenshtein(needle, window);
      if (d < best) best = d;
      if (best === 0) break;
    }
  }

  return best <= threshold ? best : null;
}
