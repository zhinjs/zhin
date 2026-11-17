/**
 * Page side of Sandbox hosted uploads (ADR 0064 D13, stage I1).
 *
 * A picked, pasted or dropped file is sent once as the raw body of
 * `POST /api/sandbox/media/<endpoint>?type=&id=` (never inside a WebSocket frame); the reply's
 * signed address becomes an inbound media segment with `media.kind: 'url'`, built by the same
 * `sandboxInboundMediaSegment` the typed syntax and the URL buttons use.
 *
 * Showing a hosted file goes through the Console download `GET /api/sandbox/media/<endpoint>/<id>`
 * with the Console credentials (the public signed route is closed by default), as a blob URL.
 */
import { sandboxInboundMediaSegment, type SandboxInboundSegment } from '../../src/inbound-syntax.js';
import {
  parseSandboxMediaUrl,
  sandboxMediaConsolePath,
  sandboxMediaUploadPath,
} from '../../src/media-url.js';
import type { SandboxRequestContext } from './sandboxTransport.js';

export interface SandboxMediaScene {
  readonly type: 'private' | 'group' | 'channel';
  readonly id: string;
}

export interface SandboxMediaUploadReply {
  readonly id: string;
  readonly kind: 'image' | 'audio' | 'video' | 'file';
  readonly mime: string;
  readonly size: number;
  readonly name?: string;
  readonly expiresAt: number;
  readonly url: string;
}

export type SandboxMediaUploadResult =
  | Readonly<{ ok: true; reply: SandboxMediaUploadReply; segment: SandboxInboundSegment }>
  | Readonly<{ ok: false; code: string; message: string }>;

export interface SandboxMediaUploadOptions {
  readonly endpointId: string;
  readonly scene: SandboxMediaScene;
  readonly context: SandboxRequestContext;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

/** The segment an upload reply becomes: same shape as a typed `[image:URL]`, plus type / size / name. */
export function sandboxUploadedSegment(reply: SandboxMediaUploadReply): SandboxInboundSegment {
  return sandboxInboundMediaSegment(reply.kind, reply.url, {
    mime_type: reply.mime, size: reply.size, ...(reply.name ? { file_name: reply.name } : {}),
  });
}

function apiUrl(context: SandboxRequestContext, path: string): URL {
  const base = context.apiBase || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  return new URL(path, `${base.replace(/\/+$/u, '')}/`);
}

function isReply(value: unknown): value is SandboxMediaUploadReply {
  if (!value || typeof value !== 'object') return false;
  const reply = value as Record<string, unknown>;
  return typeof reply.id === 'string' && typeof reply.url === 'string' && typeof reply.mime === 'string'
    && typeof reply.size === 'number' && ['image', 'audio', 'video', 'file'].includes(String(reply.kind));
}

/** Uploads one file; never throws (network and Host failures come back as `ok: false`). */
export async function uploadSandboxMedia(file: Blob & { readonly name?: string }, options: SandboxMediaUploadOptions): Promise<SandboxMediaUploadResult> {
  const url = apiUrl(options.context, sandboxMediaUploadPath(options.endpointId));
  url.searchParams.set('type', options.scene.type);
  url.searchParams.set('id', options.scene.id);
  const name = typeof file.name === 'string' ? file.name : '';
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url.href, {
      method: 'POST',
      headers: {
        ...options.context.headers,
        'content-type': file.type || 'application/octet-stream',
        ...(name ? { 'x-zhin-file-name': encodeURIComponent(name) } : {}),
      },
      body: file,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    return { ok: false, code: 'network', message: error instanceof Error ? error.message : String(error) };
  }
  const body = await response.json().catch(() => null) as { success?: boolean; data?: unknown; code?: unknown; error?: unknown } | null;
  if (!response.ok || !body?.success || !isReply(body.data)) {
    return {
      ok: false,
      code: typeof body?.code === 'string' ? body.code : `http_${response.status}`,
      message: typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`,
    };
  }
  return { ok: true, reply: body.data, segment: sandboxUploadedSegment(body.data) };
}

/** Console download address of a hosted link in `scene`, or undefined for any other address. */
export function sandboxHostedConsoleUrl(url: unknown, options: { readonly endpointId: string; readonly scene: SandboxMediaScene; readonly context: SandboxRequestContext }): string | undefined {
  const address = parseSandboxMediaUrl(url);
  if (!address) return undefined;
  const target = apiUrl(options.context, sandboxMediaConsolePath(options.endpointId, address.id));
  target.searchParams.set('type', options.scene.type);
  target.searchParams.set('id', options.scene.id);
  return target.href;
}

/**
 * A cached resolver from hosted links to blob URLs for one endpoint and conversation; `dispose`
 * revokes every blob URL it made. A link that does not resolve (deleted, expired, another
 * conversation) resolves to `undefined` and the renderer shows its placeholder.
 */
export function createSandboxHostedMediaResolver(options: {
  readonly endpointId: string;
  readonly scene: SandboxMediaScene;
  readonly context: SandboxRequestContext;
  readonly fetchImpl?: typeof fetch;
}): { readonly resolve: (url: string) => Promise<string | undefined>; readonly dispose: () => void } {
  const cache = new Map<string, Promise<string | undefined>>();
  const made: string[] = [];
  let disposed = false;
  return Object.freeze({
    resolve(url: string): Promise<string | undefined> {
      const target = sandboxHostedConsoleUrl(url, options);
      if (!target || disposed) return Promise.resolve(undefined);
      let pending = cache.get(target);
      if (!pending) {
        pending = (async () => {
          try {
            const response = await (options.fetchImpl ?? fetch)(target, { headers: { ...options.context.headers } });
            if (!response.ok) return undefined;
            const blob = await response.blob();
            if (disposed || typeof URL.createObjectURL !== 'function') return undefined;
            const objectUrl = URL.createObjectURL(blob);
            made.push(objectUrl);
            return objectUrl;
          } catch {
            return undefined;
          }
        })();
        cache.set(target, pending);
      }
      return pending;
    },
    dispose(): void {
      disposed = true;
      for (const objectUrl of made.splice(0)) {
        try { URL.revokeObjectURL(objectUrl); } catch { /* already revoked */ }
      }
      cache.clear();
    },
  });
}

/** Files carried by a paste or drop (images, audio, any file); empty for plain text. */
export function filesOfTransfer(transfer: Pick<DataTransfer, 'files' | 'items'> | null | undefined): File[] {
  if (!transfer) return [];
  const files = Array.from(transfer.files ?? []);
  if (files.length) return files;
  return Array.from(transfer.items ?? []).flatMap(item => {
    if (item.kind !== 'file') return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}
