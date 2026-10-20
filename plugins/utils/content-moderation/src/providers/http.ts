import { readFileSync } from 'node:fs';
import type {
  ExtractedImage,
  HttpSourceConfig,
  ProviderResult,
  ScanInput,
  Severity,
  TextMatch,
} from '../types.js';
import { isSeverity } from '../types.js';
import type { ModerationProvider } from './types.js';

export interface HttpProviderDeps {
  readonly fetch?: typeof fetch;
}

export class HttpModerationProvider implements ModerationProvider {
  readonly id: string;
  readonly #config: HttpSourceConfig;
  readonly #fetch: typeof fetch;

  constructor(config: HttpSourceConfig, deps: HttpProviderDeps = {}) {
    this.id = config.id;
    this.#config = config;
    this.#fetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async scan(input: ScanInput): Promise<ProviderResult> {
    try {
      const images = await prepareImages(input.images, this.#config.forceUpload, this.#fetch);
      const useMultipart = images.some((img) => img.mode === 'upload');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);
      try {
        const response = useMultipart
          ? await this.#postMultipart(input, images, controller.signal)
          : await this.#postJson(input, images, controller.signal);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const body = await response.json() as unknown;
        return parseHttpResult(this.id, body);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return Object.freeze({
        sourceId: this.id,
        severity: this.#config.onError === 'closed' ? 'critical' as const : 'pass' as const,
        error: true,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #postJson(
    input: ScanInput,
    images: readonly PreparedImage[],
    signal: AbortSignal,
  ): Promise<Response> {
    const body = {
      text: input.text,
      images: images.map((img) => (
        img.mode === 'url'
          ? { url: img.url }
          : { base64: img.base64, mime: img.mime }
      )),
      direction: input.direction,
      context: input.context,
    };
    return this.#fetch(this.#config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.#config.headers,
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  async #postMultipart(
    input: ScanInput,
    images: readonly PreparedImage[],
    signal: AbortSignal,
  ): Promise<Response> {
    const form = new FormData();
    form.set('text', input.text);
    form.set('direction', input.direction);
    form.set('context', JSON.stringify(input.context));
    for (const [i, img] of images.entries()) {
      if (img.mode === 'url') {
        form.append('images', JSON.stringify({ index: i, url: img.url }));
      } else {
        const bytes = Uint8Array.from(Buffer.from(img.base64, 'base64'));
        const mime = img.mime || 'application/octet-stream';
        form.append(
          'images',
          new Blob([bytes], { type: mime }),
          `image-${i}.${extensionForMime(mime)}`,
        );
      }
    }
    return this.#fetch(this.#config.url, {
      method: 'POST',
      headers: { ...this.#config.headers },
      body: form,
      signal,
    });
  }
}

type PreparedImage =
  | { readonly mode: 'url'; readonly url: string }
  | { readonly mode: 'upload'; readonly base64: string; readonly mime?: string };

async function prepareImages(
  images: readonly ExtractedImage[],
  forceUpload: boolean,
  fetchImpl: typeof fetch,
): Promise<PreparedImage[]> {
  const out: PreparedImage[] = [];
  for (const image of images) {
    if (!forceUpload && image.url && isPublicHttpUrl(image.url)) {
      out.push({ mode: 'url', url: image.url });
      continue;
    }
    if (image.base64) {
      out.push({ mode: 'upload', base64: image.base64, mime: image.mime });
      continue;
    }
    if (image.path) {
      const buf = readFileSync(image.path);
      out.push({
        mode: 'upload',
        base64: buf.toString('base64'),
        mime: image.mime,
      });
      continue;
    }
    if (image.url) {
      const downloaded = await downloadAsBase64(image.url, fetchImpl);
      out.push({ mode: 'upload', base64: downloaded.base64, mime: downloaded.mime ?? image.mime });
      continue;
    }
    // Opaque file refs: skip (cannot fetch without platform API)
  }
  return out;
}

async function downloadAsBase64(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ base64: string; mime?: string }> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const mime = response.headers.get('content-type') ?? undefined;
  const buf = Buffer.from(await response.arrayBuffer());
  return { base64: buf.toString('base64'), mime };
}

export function isPublicHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseHttpResult(sourceId: string, body: unknown): ProviderResult {
  if (!body || typeof body !== 'object') {
    throw new Error('invalid moderation response');
  }
  const record = body as Record<string, unknown>;
  if (!isSeverity(record.severity)) {
    throw new Error('invalid severity in moderation response');
  }
  const severity = record.severity as Severity;
  const matches = parseMatches(record.matches);
  const flaggedImageIndexes = parseFlaggedImages(record.images);
  return Object.freeze({
    sourceId,
    severity,
    ...(matches.length ? { matches } : {}),
    ...(flaggedImageIndexes.length ? { flaggedImageIndexes } : {}),
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
  });
}

function parseMatches(raw: unknown): readonly TextMatch[] {
  if (!Array.isArray(raw)) return Object.freeze([]);
  const out: TextMatch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const start = (item as { start?: unknown }).start;
    const end = (item as { end?: unknown }).end;
    if (typeof start !== 'number' || typeof end !== 'number') continue;
    if (!(end > start) || start < 0) continue;
    out.push({ start: Math.trunc(start), end: Math.trunc(end) });
  }
  return Object.freeze(out);
}

function parseFlaggedImages(raw: unknown): readonly number[] {
  if (!Array.isArray(raw)) return Object.freeze([]);
  const out: number[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const index = (item as { index?: unknown }).index;
    const flagged = (item as { flagged?: unknown }).flagged;
    if (typeof index === 'number' && Number.isFinite(index) && flagged === true) {
      out.push(Math.trunc(index));
    }
  }
  return Object.freeze(out);
}

function extensionForMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  return 'bin';
}
