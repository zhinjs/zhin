/**
 * Where a project's gateway keeps its local control endpoint and state (ADR 0054 §6):
 * `.zhin/gateway.sock` (a named pipe `\\.\pipe\zhin-gateway-<hash>` on Windows) and
 * `.zhin/gateway.json`.
 */
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';

export const GATEWAY_STATE_DIR = '.zhin';
export const GATEWAY_SOCKET_FILE = 'gateway.sock';
export const GATEWAY_INFO_FILE = 'gateway.json';
export const GATEWAY_LOG_FILE = 'gateway.log';

/** sockaddr_un.sun_path is 104 (macOS) / 108 (Linux) bytes including the terminator. */
const MAX_UNIX_SOCKET_PATH_BYTES = 100;

/** `<root>/.zhin`. */
export function gatewayStateDir(root: string): string {
  return join(resolve(root), GATEWAY_STATE_DIR);
}

/** `<root>/.zhin/gateway.json`. */
export function gatewayInfoFile(root: string): string {
  return join(gatewayStateDir(root), GATEWAY_INFO_FILE);
}

/** `<root>/.zhin/logs/gateway.log`: the background gateway's own output. */
export function gatewayLogFile(root: string): string {
  return join(gatewayStateDir(root), 'logs', GATEWAY_LOG_FILE);
}

/** Stable short hash of a project root; Windows paths are case-insensitive. */
export function projectRootHash(root: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = platform === 'win32' ? win32.resolve(root).toLowerCase() : resolve(root);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/** `\\.\pipe\zhin-gateway-<hash of the project root>`. */
export function windowsPipeName(root: string): string {
  return `\\\\.\\pipe\\zhin-gateway-${projectRootHash(root, 'win32')}`;
}

export interface GatewaySocketPathOptions {
  readonly platform?: NodeJS.Platform;
  /** Fallback directory for roots too deep for a Unix socket path. Default `os.tmpdir()`. */
  readonly tmpdir?: string;
}

/**
 * The local control endpoint of a project. Unix: `<root>/.zhin/gateway.sock`, or
 * `<tmpdir>/zhin-gateway-<hash>.sock` when that path would not fit `sun_path`.
 */
export function gatewaySocketPath(root: string, options: GatewaySocketPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') return windowsPipeName(root);
  const preferred = join(gatewayStateDir(root), GATEWAY_SOCKET_FILE);
  if (Buffer.byteLength(preferred) <= MAX_UNIX_SOCKET_PATH_BYTES) return preferred;
  return join(options.tmpdir ?? tmpdir(), `zhin-gateway-${projectRootHash(root, platform)}.sock`);
}

/** Whether an endpoint is a Windows named pipe (no file to stat, chmod or unlink). */
export function isNamedPipe(path: string): boolean {
  return path.startsWith('\\\\.\\pipe\\') || path.startsWith('\\\\?\\pipe\\');
}
