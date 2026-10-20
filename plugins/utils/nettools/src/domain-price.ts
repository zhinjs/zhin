/**
 * Domain registration / renewal / transfer price comparison through the
 * public nazhumi.com API (`GET /api/v1?domain=<suffix>&order=<kind>`).
 *
 * There is no second keyless provider with a comparable dataset, so instead
 * of a provider fallback this module tolerates partial data: entries with a
 * missing or non-numeric price are skipped, and an empty list is reported as
 * "no data" rather than an error.
 */
import { parseHostInput } from './address-policy.js';
import { NettoolsError } from './errors.js';
import type { HttpClient } from './http.js';

export const NAZHUMI_API_URL = 'https://www.nazhumi.com/api/v1';
const PROVIDER = 'nazhumi.com';

export type PriceKind = 'register' | 'renew' | 'transfer';

const PRICE_KIND_ALIASES: Readonly<Record<string, PriceKind>> = {
  register: 'register',
  new: 'register',
  reg: 'register',
  注册: 'register',
  新购: 'register',
  renew: 'renew',
  续费: 'renew',
  transfer: 'transfer',
  转入: 'transfer',
};

const PRICE_KIND_LABELS: Readonly<Record<PriceKind, string>> = {
  register: '注册',
  renew: '续费',
  transfer: '转入',
};

export interface PriceEntry {
  readonly registrar: string;
  readonly website: string | undefined;
  readonly price: number;
  readonly currency: string;
  readonly priceCny: number | undefined;
  readonly hasPromoCode: boolean;
}

export interface PriceComparison {
  readonly suffix: string;
  readonly kind: PriceKind;
  readonly entries: readonly PriceEntry[];
  readonly updatedAt: string | undefined;
}

export function parsePriceKind(input: string | undefined): PriceKind {
  if (input === undefined || input.trim() === '') {
    return 'register';
  }
  const kind = PRICE_KIND_ALIASES[input.trim().toLowerCase()];
  if (!kind) {
    throw new NettoolsError('invalid_input', '价格类型可选：注册(register) / 续费(renew) / 转入(transfer)');
  }
  return kind;
}

/**
 * Normalise user input to a domain suffix.
 * - `com`, `.com`, `.co.uk`: a leading dot or a single label is taken verbatim;
 * - `example.com`, `www.example.co.uk`: the first label is dropped
 *   (`com`, `example.co.uk` → use `.co.uk` explicitly for multi-level suffixes).
 */
export function parseDomainSuffix(input: string): string {
  const trimmed = input.trim();
  const explicitSuffix = trimmed.startsWith('.');
  const withoutDot = explicitSuffix ? trimmed.slice(1) : trimmed;
  if (withoutDot.length === 0) {
    throw new NettoolsError('invalid_input', '请提供域名后缀，例如 com 或 .cn');
  }
  const parsed = parseHostInput(withoutDot, { minLabels: 1 });
  if (parsed.kind !== 'domain') {
    throw new NettoolsError('invalid_input', '请提供域名或后缀，而不是 IP 地址');
  }
  const labels = parsed.name.split('.');
  if (explicitSuffix || labels.length === 1) {
    return parsed.name;
  }
  return labels.slice(1).join('.');
}

export async function comparePrices(
  http: HttpClient,
  suffix: string,
  kind: PriceKind,
  signal?: AbortSignal,
): Promise<PriceComparison> {
  const url = new URL(NAZHUMI_API_URL);
  url.searchParams.set('domain', suffix);
  url.searchParams.set('order', kind);
  const response = await http.fetchJson(url, {
    provider: PROVIDER,
    ...(signal ? { signal } : {}),
  });
  return parsePriceResponse(response.body, suffix, kind);
}

export function parsePriceResponse(body: unknown, suffix: string, kind: PriceKind): PriceComparison {
  if (!isRecord(body)) {
    throw new NettoolsError('malformed', 'nazhumi.com 返回了无法识别的数据');
  }
  if (typeof body.code === 'number' && body.code !== 100 && body.code !== 200 && body.code !== 0) {
    const message = typeof body.msg === 'string' ? body.msg : typeof body.message === 'string' ? body.message : '';
    throw new NettoolsError('http', `nazhumi.com 返回错误 ${body.code}${message ? `：${message}` : ''}`);
  }
  const data = isRecord(body.data) ? body.data : {};
  const rawPrices = Array.isArray(data.price) ? data.price : [];
  const entries: PriceEntry[] = [];
  let updatedAt: string | undefined;
  for (const raw of rawPrices) {
    const entry = parsePriceEntry(raw, kind);
    if (entry) {
      entries.push(entry);
    }
    if (isRecord(raw) && typeof raw.updatedtime === 'string' && (!updatedAt || raw.updatedtime > updatedAt)) {
      updatedAt = raw.updatedtime;
    }
  }
  entries.sort(compareByCnyPrice);
  return Object.freeze({ suffix, kind, entries: Object.freeze(entries), updatedAt });
}

function parsePriceEntry(raw: unknown, kind: PriceKind): PriceEntry | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const price = raw[kind];
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return undefined;
  }
  const registrar = typeof raw.registrarname === 'string' && raw.registrarname.trim()
    ? raw.registrarname.trim()
    : typeof raw.registrar === 'string' ? raw.registrar : '';
  if (!registrar) {
    return undefined;
  }
  const cny = raw[`${kind}_cny`];
  const promo = isRecord(raw.promocode) ? raw.promocode[kind] === true : false;
  const website = typeof raw.registrarweb === 'string' && raw.registrarweb.startsWith('https://')
    ? raw.registrarweb
    : undefined;
  const currency = typeof raw.currencyname === 'string' && raw.currencyname
    ? raw.currencyname
    : typeof raw.currency === 'string' ? raw.currency.toUpperCase() : '';
  return Object.freeze({
    registrar,
    website,
    price,
    currency,
    priceCny: typeof cny === 'number' && Number.isFinite(cny) ? cny : undefined,
    hasPromoCode: promo,
  });
}

/** Cheapest first by CNY equivalent; entries without CNY go last, keeping API order. */
function compareByCnyPrice(left: PriceEntry, right: PriceEntry): number {
  if (left.priceCny === undefined && right.priceCny === undefined) {
    return 0;
  }
  if (left.priceCny === undefined) {
    return 1;
  }
  if (right.priceCny === undefined) {
    return -1;
  }
  return left.priceCny - right.priceCny;
}

export function formatPriceComparison(comparison: PriceComparison, limit: number): string {
  const label = PRICE_KIND_LABELS[comparison.kind];
  if (comparison.entries.length === 0) {
    return `💰 .${comparison.suffix} 暂无${label}价格数据`;
  }
  const lines = [`💰 .${comparison.suffix} ${label}价格（低→高，nazhumi.com）`];
  comparison.entries.slice(0, limit).forEach((entry, index) => {
    const cny = entry.priceCny === undefined ? '' : `（≈¥${entry.priceCny.toFixed(2)}）`;
    const promo = entry.hasPromoCode ? ' 🎟️有优惠码' : '';
    lines.push(`${index + 1}. ${entry.registrar}：${entry.price} ${entry.currency}${cny}${promo}`);
  });
  if (comparison.entries.length > limit) {
    lines.push(`…共 ${comparison.entries.length} 家`);
  }
  const updated = comparison.updatedAt ? `，数据更新于 ${comparison.updatedAt}` : '';
  lines.push(`价格仅供参考${updated}，以注册商官网为准`);
  return lines.join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
