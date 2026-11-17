/**
 * Browser-safe shape of Sandbox-hosted media addresses (ADR 0064 D12 / D14, I1).
 *
 * A hosted object is named by a 128-bit random id; a signed address is
 * `<origin>/pub/sandbox-media/<endpoint directory key>/<id>?exp=<seconds>&sig=<HMAC>`.
 * Only the fixed path prefix and the signature format decide whether an address *looks* hosted;
 * the origin never does (behind the gateway the instance listens on no port of its own). Whether
 * the address is genuine is decided by the HMAC check in `media-store.ts`, never here.
 */

/** Public download prefix; the route is closed unless `media.publicDownload` is on. */
export const SANDBOX_MEDIA_PUBLIC_PREFIX = '/pub/sandbox-media/';
/** Console API base the page and the routes share (relative to the Host origin). */
export const SANDBOX_MEDIA_API_PREFIX = '/api/sandbox/media/';

/** 16 random bytes in base64url: exactly 22 characters, no padding, no path characters. */
export const SANDBOX_MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
/** First 16 hex characters of SHA-256(endpoint id). */
export const SANDBOX_MEDIA_DIR_PATTERN = /^[0-9a-f]{16}$/u;
/** HMAC-SHA256 in base64url: 43 characters. */
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const EXPIRY_PATTERN = /^[1-9][0-9]{0,11}$/u;

export interface SandboxMediaAddress {
  readonly dir: string;
  readonly id: string;
  /** Expiry in Unix seconds (signed). */
  readonly exp: number;
  readonly sig: string;
}

function parseLoose(url: string): URL | undefined {
  try {
    return new URL(url, 'http://sandbox.invalid/');
  } catch {
    return undefined;
  }
}

/** Whether the address claims the hosted prefix (it may still be forged; see `verifyUrl`). */
export function isSandboxMediaPath(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const parsed = parseLoose(url);
  return parsed !== undefined && parsed.pathname.startsWith(SANDBOX_MEDIA_PUBLIC_PREFIX);
}

/**
 * The parts of a hosted address in the exact signed format, or `undefined`. Extra query
 * parameters, credentials in the URL, a fragment, a second path segment or a malformed id are
 * all refused: only what the store itself issues parses.
 */
export function parseSandboxMediaUrl(url: unknown): SandboxMediaAddress | undefined {
  if (typeof url !== 'string' || url.length > 2048) return undefined;
  const parsed = parseLoose(url);
  if (!parsed || parsed.username || parsed.password || parsed.hash) return undefined;
  if (!parsed.pathname.startsWith(SANDBOX_MEDIA_PUBLIC_PREFIX)) return undefined;
  const parts = parsed.pathname.slice(SANDBOX_MEDIA_PUBLIC_PREFIX.length).split('/');
  if (parts.length !== 2) return undefined;
  const [dir, id] = parts as [string, string];
  if (!SANDBOX_MEDIA_DIR_PATTERN.test(dir) || !SANDBOX_MEDIA_ID_PATTERN.test(id)) return undefined;
  const keys = [...parsed.searchParams.keys()];
  if (keys.length !== 2 || !keys.includes('exp') || !keys.includes('sig')) return undefined;
  const exp = parsed.searchParams.get('exp') ?? '';
  const sig = parsed.searchParams.get('sig') ?? '';
  if (!EXPIRY_PATTERN.test(exp) || !SIGNATURE_PATTERN.test(sig)) return undefined;
  return Object.freeze({ dir, id, exp: Number(exp), sig });
}

/** Console upload path of an endpoint (`POST`, `endpoint.operate`). */
export function sandboxMediaUploadPath(endpointId: string): string {
  return `${SANDBOX_MEDIA_API_PREFIX}${encodeURIComponent(endpointId)}`;
}

/** Console download / delete path of one object (`GET` needs `endpoint.view`). */
export function sandboxMediaConsolePath(endpointId: string, id: string): string {
  return `${sandboxMediaUploadPath(endpointId)}/${id}`;
}
