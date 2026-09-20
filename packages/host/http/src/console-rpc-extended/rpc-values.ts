import type { ConsoleRpcExtendedCtx, EndpointManagementPort, ExtendedRpcResult } from './contracts.js';

export function requiredRpcValue(value: unknown, name: string): unknown {
  if (value === undefined || value === null) throw new Error(`${name} is required`);
  return structuredClone(value);
}

export function requiredRpcText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

export function optionalRpcText(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requiredRpcText(value, name);
}

export function optionalRpcTextArray(value: unknown, name: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${name} is invalid`);
  const result = value.map((item, index) => requiredRpcText(item, `${name}.${index}`));
  if (new Set(result).size !== result.length) throw new Error(`${name} contains duplicates`);
  return Object.freeze(result);
}

export function requiredRpcInteger(value: unknown, name: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error(`${name} is invalid`);
  return Number(value);
}

export function requiredRpcBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} is invalid`);
  return value;
}

// ---------------------------------------------------------------- cron


export function strField(d: Record<string, unknown>, key: string): string {
  const value = d[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function numField(d: Record<string, unknown>, fallback: number, key: string): number {
  const parsed = Number(d[key]);
  return d[key] != null && Number.isFinite(parsed) ? parsed : fallback;
}

export function boundedIntegerField(
  d: Record<string, unknown>,
  fallback: number,
  minimum: number,
  maximum: number,
  key: string,
): number {
  const value = numField(d, fallback, key);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export function boolField(d: Record<string, unknown>, fallback: boolean, key: string): boolean {
  const value = d[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function optionalNum(d: Record<string, unknown>, key: string): number | undefined {
  if (d[key] == null) return undefined;
  const parsed = Number(d[key]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parse one canonical numeric-array field into finite positive ids. */
export function numArrayField(d: Record<string, unknown>, key: string): number[] {
  const value = d[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

export async function withLiveEndpoint(
  ctx: ConsoleRpcExtendedCtx,
  adapter: string,
  endpointKey: string,
  run: (management: EndpointManagementPort) => ExtendedRpcResult | Promise<ExtendedRpcResult>,
): Promise<ExtendedRpcResult> {
  if (!ctx.withEndpointManagement) {
    return { error: 'Endpoint registry is not configured' };
  }
  try {
    return await ctx.withEndpointManagement(adapter, endpointKey, run)
      ?? { error: 'endpoint not found' };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}


export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
