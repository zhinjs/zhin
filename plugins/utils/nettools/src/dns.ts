import { type Locale } from 'zhin.js/i18n';
import { messages } from './presentation.js';
import { message } from './messages.js';
/**
 * DNS lookups over HTTPS (DoH JSON API) with provider fallback.
 *
 * Cloudflare (`cloudflare-dns.com/dns-query`), AliDNS (`dns.alidns.com/resolve`,
 * reachable from mainland China) and Google (`dns.google/resolve`) speak the
 * same JSON dialect. Providers are tried in
 * order; we move on to the next one when a provider is unreachable, times out,
 * returns an HTTP error, returns malformed JSON or answers SERVFAIL/REFUSED.
 * NXDOMAIN and "no records" are authoritative answers and are returned as-is.
 */
import { NettoolsError } from './errors.js';
import type { HttpClient } from './http.js';

export const DNS_RECORD_TYPES = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  DS: 43,
  DNSKEY: 48,
  CAA: 257,
} as const;

export type DnsRecordType = keyof typeof DNS_RECORD_TYPES;

export const SUPPORTED_DNS_TYPES = Object.keys(DNS_RECORD_TYPES) as DnsRecordType[];

export type DohProviderId = 'cloudflare' | 'alidns' | 'google';

export interface DohProvider {
  readonly id: DohProviderId;
  readonly label: string;
  readonly endpoint: string;
}

export const DOH_PROVIDERS: Readonly<Record<DohProviderId, DohProvider>> = Object.freeze({
  cloudflare: Object.freeze({
    id: 'cloudflare',
    label: 'Cloudflare DoH',
    endpoint: 'https://cloudflare-dns.com/dns-query',
  }),
  alidns: Object.freeze({
    id: 'alidns',
    label: 'AliDNS DoH',
    endpoint: 'https://dns.alidns.com/resolve',
  }),
  google: Object.freeze({
    id: 'google',
    label: 'Google DoH',
    endpoint: 'https://dns.google/resolve',
  }),
});

export const DEFAULT_DOH_PROVIDERS: readonly DohProviderId[] = ['cloudflare', 'alidns', 'google'];

export interface DnsRecord {
  readonly name: string;
  readonly type: string;
  readonly ttl: number;
  readonly data: string;
}

export type DnsStatus = 'NOERROR' | 'NXDOMAIN';

export interface DnsAnswer {
  readonly name: string;
  readonly type: DnsRecordType;
  readonly status: DnsStatus;
  readonly records: readonly DnsRecord[];
  /** Whether the resolver validated the answer with DNSSEC (AD bit). */
  readonly authenticated: boolean;
  readonly provider: string;
}

const RCODE_NAMES: Readonly<Record<number, string>> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

const TYPE_NAMES_BY_CODE = new Map<number, string>(
  Object.entries(DNS_RECORD_TYPES).map(([name, code]) => [code, name]),
);

export function parseDnsType(input: string | undefined): DnsRecordType {
  if (input === undefined || input.trim() === '') {
    return 'A';
  }
  const upper = input.trim().toUpperCase();
  if (Object.hasOwn(DNS_RECORD_TYPES, upper)) {
    return upper as DnsRecordType;
  }
  throw new NettoolsError(
    'invalid_input',
    message('dnsType', { type: input, types: SUPPORTED_DNS_TYPES.join(' / ') }),
  );
}

export class DohResolver {
  readonly #http: HttpClient;
  readonly #providers: readonly DohProvider[];

  constructor(http: HttpClient, providerIds: readonly DohProviderId[] = DEFAULT_DOH_PROVIDERS) {
    const unique = [...new Set(providerIds)];
    const selected = unique.length > 0 ? unique : [...DEFAULT_DOH_PROVIDERS];
    this.#http = http;
    this.#providers = selected.map((id) => DOH_PROVIDERS[id]);
  }

  get providers(): readonly DohProvider[] {
    return this.#providers;
  }

  /** Resolve `name` (already validated) for one record type, falling back across providers. */
  async resolve(name: string, type: DnsRecordType, signal?: AbortSignal): Promise<DnsAnswer> {
    const failures: (string | import('./messages.js').NettoolsMessage)[] = [];
    let lastError: NettoolsError | undefined;
    for (const [index, provider] of this.#providers.entries()) {
      const hasFallback = index < this.#providers.length - 1;
      try {
        return await this.#resolveWith(provider, name, type, hasFallback, signal);
      } catch (error) {
        if (error instanceof NettoolsError && error.kind === 'aborted') {
          throw error;
        }
        const wrapped = error instanceof NettoolsError
          ? error
          : new NettoolsError('network', message('queryFailed', { provider: provider.label }), { cause: error });
        lastError = wrapped;
        failures.push(wrapped.detail ?? wrapped.message);
      }
    }
    if (failures.length <= 1 && lastError) {
      throw lastError;
    }
    throw new NettoolsError('network', message('dnsUnavailable', { failures }), { cause: lastError });
  }

  /**
   * When another provider is still available we retry at most once here and
   * let the fallback absorb the rest, keeping the worst-case latency bounded.
   */
  async #resolveWith(
    provider: DohProvider,
    name: string,
    type: DnsRecordType,
    hasFallback: boolean,
    signal?: AbortSignal,
  ): Promise<DnsAnswer> {
    const configuredRetries = this.#http.policy.maxRetries;
    const maxRetries = hasFallback ? Math.min(1, configuredRetries) : configuredRetries;
    const url = new URL(provider.endpoint);
    url.searchParams.set('name', name);
    url.searchParams.set('type', type);
    const response = await this.#http.fetchJson(url, {
      provider: provider.label,
      accept: 'application/dns-json',
      maxRetries,
      ...(signal ? { signal } : {}),
    });
    return parseDohResponse(response.body, name, type, provider.label);
  }
}

/** Validate and normalise one DoH JSON body. Throws `malformed` or `http` (SERVFAIL etc.). */
export function parseDohResponse(body: unknown, name: string, type: DnsRecordType, provider: string): DnsAnswer {
  if (!isRecord(body) || typeof body.Status !== 'number') {
    throw new NettoolsError('malformed', message('dnsMalformed', { provider }));
  }
  const status = body.Status;
  if (status !== 0 && status !== 3) {
    const rcode = RCODE_NAMES[status] ?? `RCODE ${status}`;
    throw new NettoolsError('http', message('dnsFailed', { provider, rcode }));
  }
  const rawAnswers = Array.isArray(body.Answer) ? body.Answer : [];
  const records: DnsRecord[] = [];
  for (const raw of rawAnswers) {
    const record = parseDnsRecord(raw);
    if (record) {
      records.push(record);
    }
  }
  return Object.freeze({
    name,
    type,
    status: status === 3 ? 'NXDOMAIN' : 'NOERROR',
    records: Object.freeze(records),
    authenticated: body.AD === true,
    provider,
  });
}

function parseDnsRecord(raw: unknown): DnsRecord | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (typeof raw.data !== 'string' || typeof raw.type !== 'number') {
    return undefined;
  }
  const typeName = TYPE_NAMES_BY_CODE.get(raw.type) ?? `TYPE${raw.type}`;
  const ttl = typeof raw.TTL === 'number' && Number.isFinite(raw.TTL) ? raw.TTL : 0;
  const name = typeof raw.name === 'string' ? raw.name.replace(/\.$/u, '') : '';
  return Object.freeze({ name, type: typeName, ttl, data: raw.data });
}

export function formatDnsAnswer(answer: DnsAnswer, maxRecords = 20, locale: Locale = 'zh-CN'): string {
  const header = messages(locale, 'dnsHeader', { name: answer.name, type: answer.type, provider: answer.provider, verified: answer.authenticated ? messages(locale, 'verified') : '' });
  if (answer.status === 'NXDOMAIN') {
    return `${header}\n${messages(locale, 'nxdomain')}`;
  }
  const matching = answer.records.filter((record) => record.type === answer.type);
  const chain = answer.records.filter((record) => record.type !== answer.type);
  if (matching.length === 0 && chain.length === 0) {
    return `${header}\n${messages(locale, 'noRecord', { type: answer.type })}`;
  }
  const lines = [header];
  for (const record of chain.slice(0, maxRecords)) {
    lines.push(`↪ ${record.name} ${record.type} ${truncate(record.data)}`);
  }
  const shown = matching.slice(0, maxRecords);
  for (const record of shown) {
    lines.push(`• ${truncate(record.data)}  (TTL ${record.ttl})`);
  }
  if (matching.length > shown.length) {
    lines.push(messages(locale, 'moreRecords', { count: matching.length - shown.length }));
  }
  if (matching.length === 0) {
    lines.push(messages(locale, 'noDirectRecord', { type: answer.type }));
  }
  return lines.join('\n');
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
