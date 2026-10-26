import { type Locale } from 'zhin.js/i18n';
import { messages } from './presentation.js';
import { message } from './messages.js';
/**
 * Domain registration lookup over RDAP (RFC 9082/9083), the JSON successor
 * of WHOIS.
 *
 * 1. The IANA bootstrap registry (`data.iana.org/rdap/dns.json`) maps each TLD
 *    to its registry's RDAP base URL. It is cached in memory (default 24 h).
 *    Only `https://` bases are used.
 * 2. If the bootstrap is unavailable, lacks the TLD or the registry server
 *    fails, we fall back to the public redirector `rdap.org`.
 * 3. Last resort: the 60s API WHOIS endpoint (`60s.viki.moe/v2/whois`), which
 *    also covers TLDs without RDAP such as `.cn`. Registrant personal data in
 *    that answer is ignored on purpose.
 * 4. HTTP 404 from the TLD's own registry is authoritative ("not
 *    registered"). A 404 from rdap.org is not (the TLD may simply have no
 *    RDAP), so the WHOIS fallback still runs.
 * 5. For names with more than two labels (e.g. `www.example.com`) that are
 *    not registered we retry once with the leftmost label removed.
 */
import { NettoolsError } from './errors.js';
import type { HttpClient } from './http.js';

export const IANA_RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
export const RDAP_FALLBACK_BASE_URL = 'https://rdap.org/';
export const WHOIS_FALLBACK_URL = 'https://60s.viki.moe/v2/whois';
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
    const failures: unknown[] = [];
    const registryBases = await this.#registryBases(domain, signal);
    for (const base of registryBases) {
      try {
        return await this.#query(base, domain, signal);
      } catch (error) {
        rethrowIfAborted(error);
        failures.push(error);
      }
    }

    let rdapOrgAnswer: WhoisRecord | undefined;
    try {
      rdapOrgAnswer = await this.#query(RDAP_FALLBACK_BASE_URL, domain, signal);
      if (rdapOrgAnswer.registered) {
        return rdapOrgAnswer;
      }
    } catch (error) {
      rethrowIfAborted(error);
      failures.push(error);
    }

    try {
      return await this.#queryWhoisFallback(domain, signal);
    } catch (error) {
      rethrowIfAborted(error);
      failures.push(error);
    }

    if (rdapOrgAnswer) {
      return rdapOrgAnswer;
    }
    const lastError = failures[failures.length - 1];
    if (lastError instanceof NettoolsError) {
      throw lastError;
    }
    throw new NettoolsError('network', message('rdapFailed'), { cause: lastError });
  }

  async #queryWhoisFallback(domain: string, signal?: AbortSignal): Promise<WhoisRecord> {
    const url = new URL(WHOIS_FALLBACK_URL);
    url.searchParams.set('domain', domain);
    const response = await this.#http.fetchJson(url, {
      provider: 'WHOIS (60s.viki.moe)',
      ...(signal ? { signal } : {}),
    });
    return parseWhoisFallback(response.body, domain, url.hostname);
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
    throw new NettoolsError('malformed', message('ianaMalformed'));
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
    throw new NettoolsError('malformed', message('rdapMalformed'));
  }
  if (body.objectClassName !== undefined && body.objectClassName !== 'domain') {
    throw new NettoolsError('malformed', message('rdapNotDomain'));
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

/**
 * Parse the 60s API WHOIS answer. Only registry-level facts are kept;
 * registrant name / organisation / e-mail are deliberately dropped.
 */
export function parseWhoisFallback(body: unknown, domain: string, source: string): WhoisRecord {
  if (!isRecord(body) || !isRecord(body.data)) {
    throw new NettoolsError('malformed', message('whoisMalformed'));
  }
  if (typeof body.code === 'number' && body.code !== 200 && body.code !== 0) {
    throw new NettoolsError('http', message('whoisError', { code: String(body.code) }));
  }
  const data = body.data;
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;
  const statuses = Array.isArray(data.status)
    ? data.status.filter((value: unknown): value is string => typeof value === 'string')
    : [];
  const nameservers = Array.isArray(data.nameservers)
    ? data.nameservers.filter((value: unknown): value is string => typeof value === 'string').map((value) => value.toLowerCase())
    : [];
  const registrar = text(data.registrar);
  const createdAt = epochToIso(data.created_at) ?? text(data.created);
  const expiresAt = epochToIso(data.expires_at) ?? text(data.expires);
  const updatedAt = epochToIso(data.updated_at) ?? text(data.updated);
  const registered = Boolean(registrar || createdAt || expiresAt || statuses.length > 0 || nameservers.length > 0);
  if (!registered) {
    return unregistered(domain, source);
  }
  const dnssecText = text(data.dnssec)?.toLowerCase();
  const dnssec = dnssecText === undefined ? undefined : dnssecText !== 'unsigned' && dnssecText !== 'no';
  return Object.freeze({
    domain: (text(data.domain) ?? domain).toLowerCase(),
    registered: true,
    registrar,
    statuses: Object.freeze(statuses),
    createdAt,
    expiresAt,
    updatedAt,
    nameservers: Object.freeze(nameservers),
    dnssec,
    source,
  });
}

function epochToIso(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function rethrowIfAborted(error: unknown): void {
  if (error instanceof NettoolsError && error.kind === 'aborted') {
    throw error;
  }
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

export function formatWhoisRecord(record: WhoisRecord, locale: Locale = 'zh-CN'): string {
  if (!record.registered) {
    return messages(locale, 'noWhois', { domain: record.domain });
  }
  const lines = [messages(locale, 'whoisHeader', { domain: record.domain, source: record.source })];
  if (record.registrar) {
    lines.push(messages(locale, 'registrar', { value: record.registrar }));
  }
  if (record.createdAt) {
    lines.push(messages(locale, 'createdAt', { value: formatDate(record.createdAt) }));
  }
  if (record.expiresAt) {
    lines.push(messages(locale, 'expiresAt', { value: formatDate(record.expiresAt) }));
  }
  if (record.updatedAt) {
    lines.push(messages(locale, 'updatedAt', { value: formatDate(record.updatedAt) }));
  }
  if (record.statuses.length > 0) {
    lines.push(messages(locale, 'status', { value: record.statuses.join(', ') }));
  }
  if (record.nameservers.length > 0) {
    lines.push(messages(locale, 'nameservers', { value: record.nameservers.join(', ') }));
  }
  if (record.dnssec !== undefined) {
    lines.push(messages(locale, 'dnssec', { value: messages(locale, record.dnssec ? 'enabled' : 'disabled') }));
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
