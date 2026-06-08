/**
 * 内省列表 filter + 分页
 */

export interface PaginatedSlice<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginateItems<T>(
  all: T[],
  page: number,
  pageSize: number,
): PaginatedSlice<T> {
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: all.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

export function matchesFilter(haystack: string, filter?: string): boolean {
  if (!filter?.trim()) return true;
  return haystack.toLowerCase().includes(filter.trim().toLowerCase());
}

export function filterByFields<T>(
  items: T[],
  filter: string | undefined,
  fields: Array<(item: T) => string | undefined>,
): T[] {
  if (!filter?.trim()) return items;
  return items.filter((item) => {
    const blob = fields
      .map((f) => f(item) ?? '')
      .join(' ')
      .toLowerCase();
    return blob.includes(filter.trim().toLowerCase());
  });
}
