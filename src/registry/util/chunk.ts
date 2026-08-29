/** Splits `items` into consecutive slices of at most `size` — used to turn a
 * large batch of rows into a handful of multi-row upserts instead of one
 * query per row. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
