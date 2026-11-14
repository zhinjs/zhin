/**
 * `http.port` (and `http.listeners[].port`): an integer from 1 to 65535, written either as a number
 * or as a `${VAR}` environment reference that expands to one (#1250); `0` keeps its listener meaning
 * (the system picks a free port — tests and embedded use). Anything else is a configuration error:
 * the Host never falls back to the default port for an invalid value.
 */

/** Port the Host listens on when `http.port` is not configured (same as the scaffold writes). */
export const DEFAULT_HTTP_PORT = 8068;

/** A whole `${VAR}` / `${VAR:-default}` reference (the form the config schema accepts for a port). */
export const ENVIRONMENT_REFERENCE_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::[-=][^}]*)?\}$/u;

export class InvalidHttpPortError extends Error {
  constructor(readonly field: string, readonly value: unknown, readonly reason: string) {
    super(`${field} 无效：${reason}`);
    this.name = 'InvalidHttpPortError';
  }
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Why a stored (unexpanded) port value is invalid, in Chinese; undefined when it is valid.
 * `undefined` / `null` (not configured) are valid; `${VAR}` references are checked after expansion.
 */
export function describeInvalidPortValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) return `端口必须是整数，当前值 ${value}`;
    if (value < 0 || value > 65_535) return `端口必须在 1–65535 之间，当前值 ${value}`;
    return undefined;
  }
  if (typeof value === 'string' && ENVIRONMENT_REFERENCE_PATTERN.test(value.trim())) return undefined;
  return `端口必须是 1–65535 的整数或 \${VAR} 形式的环境变量引用，当前值 ${show(value)}`;
}

/**
 * The listening port from an expanded config value (`${VAR}` already replaced: a digit string is
 * accepted). Returns undefined when not configured; throws {@link InvalidHttpPortError} otherwise.
 * `raw` is the stored value, named in the message when it was an environment reference.
 */
export function parseHttpPort(value: unknown, field: string, raw?: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const fromReference = typeof raw === 'string' && ENVIRONMENT_REFERENCE_PATTERN.test(raw.trim()) ? `（来自 ${raw.trim()}）` : '';
  let port: number;
  if (typeof value === 'number') port = value;
  else if (typeof value === 'string' && /^\d+$/u.test(value.trim())) port = Number(value.trim());
  else if (typeof value === 'string' && value.trim() === '' && fromReference) {
    throw new InvalidHttpPortError(field, value, `环境变量未设置或为空${fromReference}；请在 .env 中设置为 1–65535 的整数`);
  } else {
    throw new InvalidHttpPortError(field, value, `端口必须是 1–65535 的整数或 \${VAR} 形式的环境变量引用，当前值 ${show(value)}${fromReference}`);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new InvalidHttpPortError(field, value, `端口必须在 1–65535 之间，当前值 ${show(value)}${fromReference}`);
  }
  return port;
}
