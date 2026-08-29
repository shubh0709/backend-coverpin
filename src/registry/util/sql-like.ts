/** Escapes `%`, `_`, and `\` so a user-typed search term is matched
 * literally by ILIKE instead of as a wildcard pattern. Postgres' default
 * ILIKE escape character is backslash, so no ESCAPE clause is needed. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
