/**
 * Which `--host` targets are this machine (#1250). Loopback addresses may receive a Console token
 * over plain HTTP; every address of this machine (loopback, unspecified, or one of its network
 * interfaces) must also prove it is this project's gateway before a token is sent there.
 *
 * `*.localhost` names are deliberately NOT loopback for plain-HTTP token sending: browsers map them
 * to loopback, but Node resolves them through the system resolver, which may send them to a DNS
 * server that answers with any address. They do count as "this machine" for the project check,
 * which only adds a refusal and never sends a token.
 *
 * Other host names are resolved (bounded by a short timeout) only for the project check: a name that
 * resolves to this machine must prove its project id as well. The answer is never used to allow a
 * plain-HTTP token, because the request resolves the name again (DNS rebinding could change it).
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import os from 'node:os';

/** `[::ffff:7f00:1]` → `127.0.0.1`; undefined when not an IPv4-mapped IPv6 address. */
function mappedIpv4(hostname: string): string | undefined {
  const bare = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(bare);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(bare);
  if (!hex) return undefined;
  const high = Number.parseInt(hex[1]!, 16);
  const low = Number.parseInt(hex[2]!, 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * Loopback (or unspecified, which connects to this machine): `localhost`, `127.0.0.0/8`, `::1`,
 * IPv4-mapped `::ffff:127.x.y.z`, `0.0.0.0` and `::`. Not `*.localhost` (see the module comment).
 */
export function isLoopbackHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/u, '');
  if (name === 'localhost') return true;
  const bare = name.replace(/^\[|\]$/gu, '');
  if (bare === '::1' || bare === '::' || bare === '0:0:0:0:0:0:0:1' || bare === '0.0.0.0') return true;
  const ipv4 = mappedIpv4(name) ?? bare;
  return /^127(?:\.\d{1,3}){3}$/u.test(ipv4) || ipv4 === '0.0.0.0';
}

export function isLoopbackUrl(value: string): boolean {
  return isLoopbackHostname(new URL(value).hostname);
}

/** Addresses of this machine's network interfaces (lower-case, IPv6 without zone). */
function interfaceAddresses(): Set<string> {
  const addresses = new Set<string>();
  try {
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries ?? []) addresses.add(entry.address.toLowerCase().replace(/%.*$/u, ''));
    }
  } catch { /* no interface list: only loopback counts */ }
  return addresses;
}

/** `*.localhost` (RFC 6761): this machine for the project check, not for plain-HTTP tokens. */
export function isLocalhostSubdomain(hostname: string): boolean {
  return hostname.toLowerCase().replace(/\.$/u, '').endsWith('.localhost');
}

function isLocalAddress(hostname: string, local: ReadonlySet<string>): boolean {
  if (isLoopbackHostname(hostname)) return true;
  const bare = hostname.replace(/^\[|\]$/gu, '').toLowerCase().replace(/%.*$/u, '');
  const mapped = mappedIpv4(hostname);
  return local.has(bare) || (mapped !== undefined && local.has(mapped));
}

/** Loopback, `*.localhost`, or an address of one of this machine's network interfaces (no DNS). */
export function isLocalMachineUrl(value: string, addresses: () => ReadonlySet<string> = interfaceAddresses): boolean {
  const hostname = new URL(value).hostname;
  return isLocalhostSubdomain(hostname) || isLocalAddress(hostname, addresses());
}

export type HostnameResolver = (hostname: string) => Promise<readonly string[]>;

const RESOLVE_TIMEOUT_MS = 1_500;

const systemResolver: HostnameResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(entry => entry.address);

/**
 * {@link isLocalMachineUrl}, plus: a host name (not an IP literal) that resolves to this machine.
 * Resolution is bounded by a short timeout; a failure or timeout means "not known to be local",
 * as before. Only for the project check, never for the plain-HTTP token decision.
 */
export async function resolvesToLocalMachine(
  value: string,
  options: { readonly addresses?: () => ReadonlySet<string>; readonly resolve?: HostnameResolver; readonly timeoutMs?: number } = {},
): Promise<boolean> {
  const addresses = options.addresses ?? interfaceAddresses;
  if (isLocalMachineUrl(value, addresses)) return true;
  const hostname = new URL(value).hostname.replace(/^\[|\]$/gu, '');
  if (isIP(hostname) !== 0) return false;
  let timer: NodeJS.Timeout | undefined;
  try {
    const resolved = await Promise.race([
      (options.resolve ?? systemResolver)(hostname),
      new Promise<readonly string[]>((resolvePromise) => {
        timer = setTimeout(() => resolvePromise([]), options.timeoutMs ?? RESOLVE_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    const local = addresses();
    return resolved.some(address => isLocalAddress(address.includes(':') ? `[${address}]` : address, local));
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
