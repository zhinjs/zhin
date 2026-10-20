/** Optional per-capability budget, isolated by sender and the complete conversation identity. */
export interface CommandExecutionPolicy {
  readonly cooldownMs?: number;
  readonly maxConcurrent?: number;
  /** One best-effort progress message while business logic is waiting; disabled by default. */
  readonly progressAfterMs?: number;
}

export interface CommandExecutionLimit {
  readonly reason: 'cooldown' | 'busy' | 'capacity' | 'operation_unavailable' | 'identity_unavailable' | 'service_unavailable';
  /** Exact remaining cooldown; a busy operation has no predictable completion time. */
  readonly retryAfterMs?: number;
}

export class CommandExecutionLimitedError extends Error {
  readonly limit: CommandExecutionLimit;
  constructor(limit: CommandExecutionLimit) {
    super(`Command execution limited: ${limit.reason}`);
    this.name = 'CommandExecutionLimitedError';
    this.limit = limit;
  }
}

/** @internal Validate at declaration and projection, without coercion or silent clamping. */
export function normalizeExecutionPolicy(value: unknown): Readonly<CommandExecutionPolicy> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Command execution must be an object');
  const limits = { cooldownMs: 86_400_000, maxConcurrent: 1000, progressAfterMs: 3_600_000 };
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(item) || (item as number) <= 0
      || (item as number) > limits[key as keyof typeof limits]) {
      throw new TypeError(`Command execution.${key} must be a positive bounded integer`);
    }
    result[key] = item as number;
  }
  if (Object.keys(result).length === 0) throw new TypeError('Command execution requires at least one policy');
  return Object.freeze(result);
}
