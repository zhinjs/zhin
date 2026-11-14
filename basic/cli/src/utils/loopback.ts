/**
 * Which `--host` targets are this machine (#1250). Loopback addresses may receive a Console token
 * over plain HTTP; every address of this machine (loopback, unspecified, or one of its network
 * interfaces) must also prove it is this project's gateway before a token is sent there.
 */
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
 * Loopback (or unspecified, which connects to this machine): `localhost` and `*.localhost`,
 * `127.0.0.0/8`, `::1`, IPv4-mapped `::ffff:127.x.y.z`, `0.0.0.0` and `::`.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/u, '');
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
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

/** Loopback, or an address of one of this machine's network interfaces. */
export function isLocalMachineUrl(value: string, addresses: () => ReadonlySet<string> = interfaceAddresses): boolean {
  const hostname = new URL(value).hostname;
  if (isLoopbackHostname(hostname)) return true;
  const bare = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  const local = addresses();
  return local.has(bare) || (mappedIpv4(hostname) !== undefined && local.has(mappedIpv4(hostname)!));
}
