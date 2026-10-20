/**
 * WBI request signing used by Bilibili web APIs (e.g. the space dynamic feed).
 *
 * The permutation below is the published WBI mixin-key order: the browser
 * concatenates the file names of `wbi_img.img_url` and `wbi_img.sub_url`
 * from `/x/web-interface/nav`, reorders the 64 characters with this table and
 * keeps the first 32 as the salt for an MD5 over the sorted query string.
 */
import { createHash } from 'node:crypto';

const MIXIN_KEY_ORDER: readonly number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/** `https://i0.hdslb.com/bfs/wbi/7cd0...077c.png` → `7cd0...077c`. */
export function wbiKeyFromUrl(url: string): string {
  const file = url.slice(url.lastIndexOf('/') + 1);
  const dot = file.indexOf('.');
  return dot === -1 ? file : file.slice(0, dot);
}

export function mixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey;
  if (raw.length < 64) throw new Error('WBI 密钥格式异常');
  let key = '';
  for (const index of MIXIN_KEY_ORDER) key += raw[index] ?? '';
  return key.slice(0, 32);
}

function stripReserved(value: string): string {
  let out = '';
  for (const char of value) if (!"!'()*".includes(char)) out += char;
  return out;
}

/** Returns the signed query string (`a=1&wts=...&w_rid=...`). */
export function signWbi(
  params: Readonly<Record<string, string | number>>,
  key: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const all: Record<string, string> = { wts: String(nowSeconds) };
  for (const [name, value] of Object.entries(params)) all[name] = stripReserved(String(value));
  const query = Object.keys(all)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(all[name]!)}`)
    .join('&');
  const wRid = createHash('md5').update(query + key).digest('hex');
  return `${query}&w_rid=${wRid}`;
}
