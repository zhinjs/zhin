import type { ServerResponse } from 'node:http';

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

export function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

export function writeSse(
  response: ServerResponse,
  type: string,
  data: unknown,
  id?: string,
): void {
  if (id) response.write(`id: ${id}\n`);
  response.write(`event: ${type}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function normalizeBase(value: string): string {
  if (!value.startsWith('/')) return `/${value}`;
  return value.replace(/\/+$/u, '') || '/api';
}
