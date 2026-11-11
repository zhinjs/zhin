import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
import { fetchPublic, type HostLookup } from './public-fetch.js';

const REQUEST_TIMEOUT_MS = 10_000;

export function isValidUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function shortenUrl(url: string, locale?: Locale): Promise<string> {
  const api = `https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`;
  const res = await fetch(api, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(t(locale, 'serviceError', { status: res.status }));
  const data = (await res.json()) as { shorturl?: string; errorcode?: number; errormessage?: string };
  if (!data.shorturl) throw new Error(data.errormessage ?? t(locale, 'noResult'));
  return data.shorturl;
}

/**
 * Follow the redirect chain of a user-supplied link and return where it ends.
 * Every hop must be a public address (no internal hosts or metadata endpoints); the body is never read.
 */
export async function expandUrl(url: string, locale?: Locale, lookup?: HostLookup): Promise<string> {
  const { response, url: finalUrl } = await fetchPublic(url, { timeoutMs: REQUEST_TIMEOUT_MS, lookup });
  await response.body?.cancel();
  if (finalUrl !== new URL(url).href) return finalUrl;
  if (response.ok) return url;
  throw new Error(t(locale, 'expandError', { status: response.status }));
}
