/**
 * QQ markdown 图片语法 `![alt #宽px #高px](url)` 需要图片尺寸：对公网 URL 图片只读取文件头
 * （≤64 KiB）解析 PNG / JPEG / GIF / WebP 尺寸。探测失败返回 undefined，由调用方降级。
 */
export interface QqImageSize {
  readonly width: number;
  readonly height: number;
}

const PROBE_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 3000;

export type ImageProbeFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  readonly ok: boolean;
  readonly body?: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** 从图片文件头解析尺寸（PNG / GIF / JPEG / WebP）。 */
export function imageSizeFromBytes(bytes: Uint8Array): QqImageSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = (width: number, height: number): QqImageSize | undefined =>
    width > 0 && height > 0 ? { width, height } : undefined;
  const ascii = (offset: number, length: number): string =>
    offset + length <= bytes.length ? String.fromCharCode(...bytes.subarray(offset, offset + length)) : '';

  // PNG: 8 字节签名 + IHDR
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') {
    return size(view.getUint32(16), view.getUint32(20));
  }
  // GIF87a / GIF89a
  if (bytes.length >= 10 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) {
    return size(view.getUint16(6, true), view.getUint16(8, true));
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') {
      const w = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const h = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return size(w, h);
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const b = view.getUint32(21, true);
      return size((b & 0x3fff) + 1, ((b >>> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8 ') return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    return undefined;
  }
  // JPEG: 扫描 SOFn 段
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 <= bytes.length) {
      if (bytes[offset] !== 0xff) return undefined;
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) { offset += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return size(view.getUint16(offset + 7), view.getUint16(offset + 5));
      }
      offset += 2 + length;
    }
  }
  return undefined;
}

async function readHead(response: Awaited<ReturnType<ImageProbeFetch>>): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer()).subarray(0, PROBE_BYTES);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < PROBE_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(total, PROBE_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, out.length - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.length) break;
  }
  return out;
}

/** 读取公网图片文件头得到尺寸；网络错误、超时或格式不识别时返回 undefined。 */
export interface ImageProbeOptions {
  readonly fetch?: ImageProbeFetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}
export async function probeImageSize(
  url: string,
  { fetch: fetchImpl = fetch as unknown as ImageProbeFetch, timeoutMs = PROBE_TIMEOUT_MS, signal }: ImageProbeOptions = {},
): Promise<QqImageSize | undefined> {
  try {
    const response = await fetchImpl(url, {
      headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return undefined;
    return imageSizeFromBytes(await readHead(response));
  } catch {
    return undefined;
  }
}
