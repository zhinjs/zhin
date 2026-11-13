/** Row-cap helpers of `Transaction.queryStatement` (internal, not part of the public entry). */

/** Marks a row array as cut at `maxRows` (non-enumerable, so JSON and equality ignore it). */
export function markTruncated<T extends unknown[]>(rows: T, truncated: boolean): T {
  if (Array.isArray(rows) && !Object.isFrozen(rows)) Object.defineProperty(rows, 'truncated', { value: truncated, enumerable: false, configurable: true });
  return rows;
}

/** Applies {@link StatementQueryOptions.maxRows} to a fully read result. */
export function capRows<T>(result: T, maxRows: number | undefined): T {
  if (maxRows === undefined || !Array.isArray(result)) return result;
  const extra = result.length > maxRows;
  if (extra) result.splice(maxRows);
  return markTruncated(result, extra) as T;
}
