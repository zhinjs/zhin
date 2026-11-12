export function parseBoundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

/** A complete HTML page response. */
export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** One Server-Sent Events frame. */
export function sseFrame(type: string, data: unknown, id?: string): string {
  return `${id ? `id: ${id}\n` : ''}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function normalizeBase(value: string): string {
  if (!value.startsWith('/')) return `/${value}`;
  // Linear trim instead of /\/+$/ (polynomial backtracking on long runs of '/').
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end -= 1;
  return value.slice(0, end) || '/api';
}
