/**
 * `media` endpoint configuration (ADR 0064 D12.2 / D12.3 as revised 2026-11-17).
 *
 * Every upload passes the management gateway, which caps a forwarded request body at
 * `DEFAULT_GATEWAY_MAX_REQUEST_BODY_BYTES` (64 MiB). A single file can therefore never be larger
 * than that, whatever this config says: the hard ceiling below is the same number (a test keeps
 * them equal). Allowing larger files needs the gateway's limit raised as well.
 */

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

export type SandboxMediaKind = 'image' | 'audio' | 'video' | 'file';
export const SANDBOX_MEDIA_KINDS: readonly SandboxMediaKind[] = Object.freeze(['image', 'audio', 'video', 'file']);

/** Ceiling of one file: the gateway's forwarded-body limit (`DEFAULT_GATEWAY_MAX_REQUEST_BODY_BYTES`). */
export const SANDBOX_MEDIA_HARD_MAX_FILE_BYTES = 64 * MiB;
/** Ceiling of an endpoint's total quota (and so of a per-uploader quota). */
export const SANDBOX_MEDIA_HARD_MAX_QUOTA_BYTES = 5 * GiB;
export const SANDBOX_MEDIA_MIN_TTL_HOURS = 1;
/** Longest link lifetime; until then an object is revoked only by deleting it (or by revoke-all). */
export const SANDBOX_MEDIA_MAX_TTL_HOURS = 168;

export interface SandboxMediaConfig {
  readonly ttlHours?: number;
  /** Open `/pub/sandbox-media/*` (time-limited, signed external links). Default false. */
  readonly publicDownload?: boolean;
  readonly maxBytes?: Partial<Record<SandboxMediaKind, number>>;
  /** Live bytes one uploader may hold on this endpoint. */
  readonly uploaderQuotaBytes?: number;
  /** Live bytes the whole endpoint may hold. */
  readonly quotaBytes?: number;
}

export interface ResolvedSandboxMediaConfig {
  readonly ttlHours: number;
  readonly publicDownload: boolean;
  readonly maxBytes: Readonly<Record<SandboxMediaKind, number>>;
  readonly uploaderQuotaBytes: number;
  readonly quotaBytes: number;
}

/** Defaults stay well below the 64 MiB gateway body limit, so a default setup never meets its 413. */
export const SANDBOX_MEDIA_DEFAULTS: ResolvedSandboxMediaConfig = Object.freeze({
  ttlHours: 24,
  publicDownload: false,
  maxBytes: Object.freeze({ image: 10 * MiB, audio: 20 * MiB, video: 32 * MiB, file: 32 * MiB }),
  uploaderQuotaBytes: 200 * MiB,
  quotaBytes: 500 * MiB,
});

function positiveInteger(value: unknown, name: string, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new TypeError(`media.${name} must be a positive integer`);
  if (value > max) throw new TypeError(`media.${name} must not exceed ${max} bytes`);
  return value;
}

/** Validates and fills `media`; out-of-range values fail endpoint configuration instead of being clamped. */
export function resolveSandboxMediaConfig(input: unknown): ResolvedSandboxMediaConfig {
  if (input === undefined || input === null) return SANDBOX_MEDIA_DEFAULTS;
  if (typeof input !== 'object' || Array.isArray(input)) throw new TypeError('media must be an object');
  const config = input as SandboxMediaConfig;
  const ttlHours = config.ttlHours ?? SANDBOX_MEDIA_DEFAULTS.ttlHours;
  if (typeof ttlHours !== 'number' || !Number.isInteger(ttlHours)
    || ttlHours < SANDBOX_MEDIA_MIN_TTL_HOURS || ttlHours > SANDBOX_MEDIA_MAX_TTL_HOURS) {
    throw new TypeError(`media.ttlHours must be an integer from ${SANDBOX_MEDIA_MIN_TTL_HOURS} to ${SANDBOX_MEDIA_MAX_TTL_HOURS}`);
  }
  if (config.publicDownload !== undefined && typeof config.publicDownload !== 'boolean') throw new TypeError('media.publicDownload must be a boolean');
  const maxInput = config.maxBytes ?? {};
  if (typeof maxInput !== 'object' || Array.isArray(maxInput)) throw new TypeError('media.maxBytes must be an object');
  const maxBytes = Object.freeze(Object.fromEntries(SANDBOX_MEDIA_KINDS.map(kind => [kind,
    positiveInteger(maxInput[kind], `maxBytes.${kind}`, SANDBOX_MEDIA_HARD_MAX_FILE_BYTES) ?? SANDBOX_MEDIA_DEFAULTS.maxBytes[kind]])) as Record<SandboxMediaKind, number>);
  const quotaBytes = positiveInteger(config.quotaBytes, 'quotaBytes', SANDBOX_MEDIA_HARD_MAX_QUOTA_BYTES) ?? SANDBOX_MEDIA_DEFAULTS.quotaBytes;
  const uploaderQuotaBytes = positiveInteger(config.uploaderQuotaBytes, 'uploaderQuotaBytes', SANDBOX_MEDIA_HARD_MAX_QUOTA_BYTES)
    ?? Math.min(SANDBOX_MEDIA_DEFAULTS.uploaderQuotaBytes, quotaBytes);
  if (uploaderQuotaBytes > quotaBytes) throw new TypeError('media.uploaderQuotaBytes must not exceed media.quotaBytes');
  return Object.freeze({ ttlHours, publicDownload: config.publicDownload === true, maxBytes, uploaderQuotaBytes, quotaBytes });
}
