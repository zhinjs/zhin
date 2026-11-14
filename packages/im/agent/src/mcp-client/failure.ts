/**
 * Why an MCP client is not connected (#1250): a coarse category plus a short, redacted message,
 * shown in the Console MCP list and written to the warn log. Never carries headers, env values,
 * URL credentials or query strings.
 */

import type { McpServerEntry } from '../resource-hub/types.js';

export type McpConnectionFailureCategory =
  /** The server refused the credentials (401/403, invalid token). */
  | 'auth'
  /** DNS, refused/reset connection, TLS or other transport failure. */
  | 'network'
  /** The connection attempt timed out. */
  | 'timeout'
  /** The entry is incomplete or invalid (missing url/command, bad URL, command not found). */
  | 'config'
  /** The stdio server process exited or closed the connection during start-up. */
  | 'process_exit'
  /** `@modelcontextprotocol/sdk` is not installed. */
  | 'sdk_missing'
  | 'unknown';

export interface McpConnectionFailure {
  readonly category: McpConnectionFailureCategory;
  /** Redacted, at most {@link MCP_FAILURE_MESSAGE_LIMIT} characters. */
  readonly message: string;
  /** Exit code of the stdio server process, when it exited. */
  readonly exitCode?: number;
  /** Epoch milliseconds of the failed attempt. */
  readonly at: number;
}

export const MCP_FAILURE_MESSAGE_LIMIT = 200;

/** Thrown before any transport starts when the entry cannot be used. */
export class McpConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConfigurationError';
  }
}

export class McpSdkMissingError extends Error {
  constructor() {
    super('@modelcontextprotocol/sdk not installed — MCP client disabled');
    this.name = 'McpSdkMissingError';
  }
}

/** A connect failure with its classified reason; the message is the original error's. */
export class McpConnectionError extends Error {
  constructor(readonly failure: McpConnectionFailure, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'McpConnectionError';
  }
}

/** Remove secrets the entry or the message itself could carry. */
export function redactMcpFailureMessage(message: string, entry?: Pick<McpServerEntry, 'headers' | 'env'>): string {
  let text = message;
  const secrets = [...Object.values(entry?.headers ?? {}), ...Object.values(entry?.env ?? {})]
    .filter((value): value is string => typeof value === 'string' && value.length >= 4)
    .sort((left, right) => right.length - left.length);
  for (const secret of secrets) text = text.split(secret).join('***');
  text = text
    // URL credentials and query strings / fragments.
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, '$1***@')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]*)[?#][^\s]*/giu, '$1')
    // Bearer tokens and key=value / key: value secrets.
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/giu, '$1 ***')
    .replace(/\b((?:api[_-]?key|access[_-]?token|token|secret|password|authorization)\s*[=:]\s*)\S+/giu, '$1***')
    .replace(/\s+/gu, ' ')
    .trim();
  return text.length > MCP_FAILURE_MESSAGE_LIMIT ? `${text.slice(0, MCP_FAILURE_MESSAGE_LIMIT - 1)}…` : text;
}

function errorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Classify a connect failure. `exitCode` is the stdio process' exit code when known. */
export function classifyMcpFailure(
  error: unknown,
  entry?: Pick<McpServerEntry, 'headers' | 'env' | 'transport'>,
  exitCode?: number,
  now: number = Date.now(),
): McpConnectionFailure {
  const raw = error instanceof Error ? error.message : String(error);
  const code = errorCode(error);
  const status = error && typeof error === 'object'
    ? (error as { status?: unknown; code?: unknown }).status ?? (error as { code?: unknown }).code
    : undefined;
  let category: McpConnectionFailureCategory;
  if (error instanceof McpSdkMissingError) category = 'sdk_missing';
  else if (error instanceof McpConfigurationError || error instanceof TypeError && /invalid url/iu.test(raw)) category = 'config';
  else if (status === 401 || status === 403 || /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[_ ](?:token|api[_ ]?key|credentials)|authentication/iu.test(raw)) category = 'auth';
  else if (code === 'ETIMEDOUT' || /timed? ?out|timeout/iu.test(raw)) category = 'timeout';
  else if (code === 'ENOENT' || code === 'EACCES' || /\bspawn\b.*\b(ENOENT|EACCES)\b/u.test(raw)) category = 'config';
  else if (code && /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_\w+|CERT_\w+|ERR_TLS\w*)$/u.test(code)
    || /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|getaddrinfo|socket hang up|network/iu.test(raw)) category = 'network';
  else if (exitCode !== undefined || (entry?.transport === 'stdio' && /connection closed|exited|process exit/iu.test(raw))) category = 'process_exit';
  else category = 'unknown';
  return Object.freeze({
    category,
    message: redactMcpFailureMessage(raw || category, entry),
    ...(exitCode === undefined ? {} : { exitCode }),
    at: now,
  });
}
