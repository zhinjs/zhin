import { message, formatMessage } from './messages.js';
/**
 * Resolve-and-check guard for hosts that will be actively probed (ping).
 *
 * Literal IPs are classified directly. Hostnames are checked by name, then
 * resolved for both A and AAAA through DoH; the target is refused when ANY
 * returned address is blocked (an attacker controlling a zone could otherwise
 * mix one public and one private record). Resolution failure fails closed.
 *
 * Note on DNS rebinding: the probe itself is executed by check-host.net, which
 * resolves the name again on its own network. Our process never connects to
 * the target, so a rebinding answer can only make check-host.net probe its own
 * neighbourhood, never ours; the pre-check stops casual abuse and obvious
 * internal names.
 */
import {
  classifyAddress,
  classifyParsedHost,
  displayHost,
  parseHostInput,
  type ParsedHost,
} from './address-policy.js';
import type { DohResolver } from './dns.js';
import { NettoolsError } from './errors.js';

export interface CheckedTarget {
  readonly host: ParsedHost;
  /** Canonical host string to send to the probing service. */
  readonly display: string;
  /** Addresses the name resolved to (empty for IP literals). */
  readonly resolvedAddresses: readonly string[];
}

export async function assertPublicTarget(
  input: string,
  resolver: DohResolver,
  signal?: AbortSignal,
): Promise<CheckedTarget> {
  const host = parseHostInput(input);
  const display = displayHost(host);
  const verdict = classifyParsedHost(host);
  if (verdict.blocked) {
    throw new NettoolsError('blocked_target', message('probeBlocked', { host: display, reason: verdict.detail }));
  }
  if (host.kind !== 'domain') {
    return Object.freeze({ host, display, resolvedAddresses: Object.freeze([]) });
  }

  const [ipv4, ipv6] = await Promise.all([
    resolver.resolve(host.name, 'A', signal),
    resolver.resolve(host.name, 'AAAA', signal),
  ]);
  const addresses: string[] = [];
  for (const answer of [ipv4, ipv6]) {
    for (const record of answer.records) {
      if (record.type === 'A' || record.type === 'AAAA') {
        addresses.push(record.data);
      }
    }
  }
  if (addresses.length === 0) {
    throw new NettoolsError('not_found', message('noAddresses', { host: display }));
  }
  for (const address of addresses) {
    const addressVerdict = safeClassify(address);
    if (addressVerdict.blocked) {
      throw new NettoolsError(
        'blocked_target',
        message('resolvedBlocked', { host: display, address, reason: addressVerdict.detail }),
      );
    }
  }
  return Object.freeze({ host, display, resolvedAddresses: Object.freeze(addresses) });
}

/** A record value that is not a parsable IP is treated as blocked (fail closed). */
function safeClassify(address: string): import('./address-policy.js').AddressVerdict {
  try {
    return classifyAddress(address);
  } catch {
    const detail = message('unknownAddress');
    return { blocked: true, reason: formatMessage(detail), detail };
  }
}
