import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';

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
  const res = await fetch(api);
  if (!res.ok) throw new Error(t(locale, 'serviceError', { status: res.status }));
  const data = (await res.json()) as { shorturl?: string; errorcode?: number; errormessage?: string };
  if (!data.shorturl) throw new Error(data.errormessage ?? t(locale, 'noResult'));
  return data.shorturl;
}

export async function expandUrl(url: string, locale?: Locale): Promise<string> {
  // 不能用 redirect:'manual'：undici 下返回 opaqueredirect（status 0、headers 空），
  // 拿不到 location。改为跟随重定向后比较最终 URL。
  const res = await fetch(url, { redirect: 'follow' });
  if (res.url && res.url !== url) return res.url;
  if (res.ok) return url;
  throw new Error(t(locale, 'expandError', { status: res.status }));
}
