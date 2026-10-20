/**
 * Domain registration lookup over RDAP (RFC 9082/9083), the JSON successor
 * of WHOIS.
 *
 * 1. The IANA bootstrap registry (`data.iana.org/rdap/dns.json`) maps each TLD
 *    to its registry's RDAP base URL. It is cached in memory (default 24 h).
 *    Only `https://` bases are used.
 * 2. If the bootstrap is unavailable, lacks the TLD or the registry server
 *    fails, we fall back to the public redirector `rdap.org`.
 * 3. HTTP 404 means "not registered / not in this registry". For names with
 *    more than two labels (e.g. `www.example.com`) we retry once with the
 *    leftmost label removed.
 */
import { NettoolsError } from './errors.js';
import type { HttpClient } from './http.js';

export const IANA_RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
export const RDAP_FALLBACK_BASE_URL = 'https://rdap.org/';
export const DEFAULT_BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const RDAP_ACCEPT = 'application/rdap+json, application/json;q=0.9';

export interface WhoisRecord {
  readonly domain: string;
  readonly registered: boolean;
  readonly registrar: string | undefined;
  readonly statuses: readonly string[];
  readonly createdAt: string | undefined;
  readonly expiresAt: string | undefined;
  readonly updatedAt: string | undefined;
  readonly nameservers: readonly string[];
  readonly dnssec: boolean | undefined;
  readonly source: string;
}

interface BootstrapCache {
  readonly fetchedAt: number;
  readonly servers: ReadonlyMap<string, readonly string[]>;
}

export class RdapClient {
  readonly #http: HttpClient;
  readonly #bootstrapTtlMs: number;
  #cache: BootstrapCache | undefined;

  constructor(http: HttpClient, bootstrapTtlMs = DEFAULT_BOOTSTRAP_TTL_MS) {
    this.#http = http;
    this.#bootstrapTtlMs = bootstrapTtlMs;
  }

  async lookup(domain: string, signal?: AbortSignal): Promise<WhoisRecord> {
    const first = await this.#lookupExact(domain, signal);
    if (first.registered) {
      return first;
    }
    const labels = domain.split('.');
    if (labels.length <= 2) {
      return first;
    }
    const parent = labels.slice(1).join('.');
    const second = await this.#lookupExact(parent, signal);
    return second.registered ? second : first;
  }

  async #lookupExact(domain: string, signal?: AbortSignal): Promise<WhoisRecord> {
    const bases = await this.#registryBases(domain, signal);
    let lastError: unknown;
    for (const base of [...bases, RDAP_FALLBACK_BASE_URL]) {
      try {
        return await this.#query(base, domain, signal);
      } catch (error) {
        if (error instanceof NettoolsError && error.kind === 'aborted') {
          throw error;
        }
        lastError = error;
      }
    }
    if (lastError instanceof NettoolsError) {
      throw lastError;
    }
    throw new NettoolsError('network', 'RDAP 查询失败', { cause: lastError });
  }

  async #query(base: string, domain: string, signal?: AbortSignal): Promise<WhoisRecord> {
    const baseUrl = new URL(base.endsWith('/') ? base : `${base}/`);
    const url = new URL(`domain/${encodeURIComponent(domain)}`, baseUrl);
    const response = await this.#http.fetchJson(url, {
      provider: `RDAP (${baseUrl.hostname})`,
      accept: RDAP_ACCEPT,
      passStatuses: [404],
      ...(signal ? { signal } : {}),
    });
    if (response.status === 404) {
      return unregistered(domain, baseUrl.hostname);
    }
    return parseRdapDomain(response.body, domain, baseUrl.hostname);
  }

  /** RDAP base URLs for the domain's TLD; empty when the bootstrap is unavailable. */
  async #registryBases(domain: string, signal?: AbortSignal): Promise<readonly string[]> {
    const servers = await this.#bootstrap(signal);
    if (!servers) {
      return [];
    }
    const labels = domain.split('.');
    for (let index = 0; index < labels.length; index += 1) {
      const suffix = labels.slice(index).join('.');
      const match = servers.get(suffix);
      if (match) {
        return match;
      }
    }
    return [];
  }

  async #bootstrap(signal?: AbortSignal): Promise<ReadonlyMap<string, readonly string[]> | undefined> {
    const now = this.#http.dependencies.now();
    if (this.#cache && now - this.#cache.fetchedAt < this.#bootstrapTtlMs) {
      return this.#cache.servers;
    }
    try {
      const response = await this.#http.fetchJson(new URL(IANA_RDAP_BOOTSTRAP_URL), {
        provider: 'IANA RDAP bootstrap',
        ...(signal ? { signal } : {}),
      });
      const servers = parseBootstrap(response.body);
      this.#cache = { fetchedAt: now, servers };
      return servers;
    } catch (error) {
      if (error instanceof NettoolsError && error.kind === 'aborted') {
        throw error;
      }
      // Stale data beats no data; otherwise fall back to rdap.org.
      return this.#cache?.servers;
    }
  }
}

/** Parse the IANA bootstrap file into suffix → https base URLs. */
export function parseBootstrap(body: unknown): ReadonlyMap<string, readonly string[]> {
  const servers = new Map<string, readonly string[]>();
  if (!isRecord(body) || !Array.isArray(body.services)) {
    throw new NettoolsError('malformed', 'IANA RDAP 引导数据格式异常');
  }
  for (const service of body.services) {
    if (!Array.isArray(service) || !Array.isArray(service[0]) || !Array.isArray(service[1])) {
      continue;
    }
    const urls = service[1].filter(
      (value: unknown): value is string => typeof value === 'string' && value.startsWith('https://'),
    );
    if (urls.length === 0) {
      continue;
    }
    for (const suffix of service[0]) {
      if (typeof suffix === 'string' && suffix.length > 0) {
        servers.set(suffix.toLowerCase(), Object.freeze(urls));
      }
    }
  }
  return servers;
}

export function parseRdapDomain(body: unknown, domain: string, source: string): WhoisRecord {
  if (!isRecord(body)) {
    throw new NettoolsError('malformed', 'RDAP 返回了无法识别的数据');
  }
  if (body.objectClassName !== undefined && body.objectClassName !== 'domain') {
    throw new NettoolsError('malformed', 'RDAP 返回的不是域名对象');
  }
  const name = typeof body.ldhName === 'string' ? body.ldhName.toLowerCase() : domain;
  const events = Array.isArray(body.events) ? body.events : [];
  const eventDate = (action: string): string | undefined => {
    for (const event of events) {
      if (isRecord(event) && event.eventAction === action && typeof event.eventDate === 'string') {
        return event.eventDate;
      }
    }
    return undefined;
  };
  const statuses = Array.isArray(body.status)
    ? body.status.filter((value: unknown): value is string => typeof value === 'string')
    : [];
  const nameservers: string[] = [];
  if (Array.isArray(body.nameservers)) {
    for (const nameserver of body.nameservers) {
      if (isRecord(nameserver) && typeof nameserver.ldhName === 'string') {
        nameservers.push(nameserver.ldhName.toLowerCase());
      }
    }
  }
  const secureDns = isRecord(body.secureDNS) ? body.secureDNS : undefined;
  const dnssec = typeof secureDns?.delegationSigned === 'boolean' ? secureDns.delegationSigned : undefined;
  return Object.freeze({
    domain: name,
    registered: true,
    registrar: findRegistrarName(body.entities),
    statuses: Object.freeze(statuses),
    createdAt: eventDate('registration'),
    expiresAt: eventDate('expiration'),
    updatedAt: eventDate('last changed'),
    nameservers: Object.freeze(nameservers),
    dnssec,
    source,
  });
}

function findRegistrarName(entities: unknown): string | undefined {
  if (!Array.isArray(entities)) {
    return undefined;
  }
  for (const entity of entities) {
    if (!isRecord(entity) || !Array.isArray(entity.roles) || !entity.roles.includes('registrar')) {
      continue;
    }
    const fullName = readVcardFullName(entity.vcardArray);
    if (fullName) {
      return fullName;
    }
    if (typeof entity.handle === 'string') {
      return entity.handle;
    }
  }
  return undefined;
}

/** jCard: ["vcard", [["fn", {}, "text", "Name"], …]] */
function readVcardFullName(vcard: unknown): string | undefined {
  if (!Array.isArray(vcard) || !Array.isArray(vcard[1])) {
    return undefined;
  }
  for (const property of vcard[1]) {
    if (Array.isArray(property) && property[0] === 'fn' && typeof property[3] === 'string' && property[3].trim()) {
      return property[3].trim();
    }
  }
  return undefined;
}

function unregistered(domain: string, source: string): WhoisRecord {
  return Object.freeze({
    domain,
    registered: false,
    registrar: undefined,
    statuses: Object.freeze([]),
    createdAt: undefined,
    expiresAt: undefined,
    updatedAt: undefined,
    nameservers: Object.freeze([]),
    dnssec: undefined,
    source,
  });
}

export function formatWhoisRecord(record: WhoisRecord): string {
  if (!record.registered) {
    return `📇 ${record.domain}\n未查询到注册信息（可能未注册，或该后缀未提供 RDAP）`;
  }
  const lines = [`📇 ${record.domain} 注册信息（RDAP: ${record.source}）`];
  if (record.registrar) {
    lines.push(`注册商：${record.registrar}`);
  }
  if (record.createdAt) {
    lines.push(`注册时间：${formatDate(record.createdAt)}`);
  }
  if (record.expiresAt) {
    lines.push(`到期时间：${formatDate(record.expiresAt)}`);
  }
  if (record.updatedAt) {
    lines.push(`最近更新：${formatDate(record.updatedAt)}`);
  }
  if (record.statuses.length > 0) {
    lines.push(`状态：${record.statuses.join(', ')}`);
  }
  if (record.nameservers.length > 0) {
    lines.push(`DNS 服务器：${record.nameservers.join(', ')}`);
  }
  if (record.dnssec !== undefined) {
    lines.push(`DNSSEC：${record.dnssec ? '已启用' : '未启用'}`);
  }
  return lines.join('\n');
}

/** Keep the date part of an ISO timestamp (UTC); leave anything else untouched. */
function formatDate(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T/u.exec(value);
  return match ? `${match[1]} (UTC)` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
