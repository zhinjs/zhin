/**
 * Sandbox media HTTP routes (ADR 0064 D12.5 / D13.2, revised 2026-11-17; stage I1).
 *
 * Under the Console API base (authenticated and authorized by the Host against the permission map
 * of `@zhin.js/console-protocol`; behind the gateway, by the gateway first):
 * - `POST   /api/sandbox/media/<endpoint>?type=&id=`        upload (`endpoint.operate`)
 * - `GET    /api/sandbox/media/<endpoint>/<id>?type=&id=`   Console download (`endpoint.view`)
 * - `DELETE /api/sandbox/media/<endpoint>/<id>`             delete = revoke (`endpoint.operate`, uploader or global owner)
 * - `POST   /api/sandbox/media/<endpoint>/secret`           `{ action: 'rotate' | 'revoke-all' }` (global owner)
 *
 * Public, closed by default (`media.publicDownload: false` → always 404):
 * - `GET /pub/sandbox-media/<dir>/<id>?exp=&sig=` — only a valid, unexpired signature opens it.
 *   The peer address is never an authorization: behind a same-host reverse proxy everything looks
 *   like 127.0.0.1, and in-process readers use the store, not HTTP (I2: `LocalMediaSource.read`).
 *
 * Every refusal of a download is a bare 404 that does not tell a bad signature, an expired link, a
 * missing object or another conversation apart.
 */
import {
  auditActor,
  isGlobalOwnerPrincipal,
  jsonResponse,
  principalAllows,
  type ConsolePrincipal,
  type HttpHost,
  type RouteContext,
} from '@zhin.js/host-http';
import { SandboxMediaError, type SandboxMediaConversation, type SandboxMediaMeta, type SandboxMediaStore } from './media-store.js';
import { SANDBOX_MEDIA_PUBLIC_PREFIX, sandboxMediaUploadPath } from './media-url.js';

export interface SandboxMediaRouteLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface SandboxMediaRoutesOptions {
  readonly http: Pick<HttpHost, 'route' | 'address'>;
  readonly store: SandboxMediaStore;
  readonly logger: SandboxMediaRouteLogger;
}

/** What one upload returns to the page. */
export interface SandboxMediaUploadReply {
  readonly id: string;
  readonly kind: SandboxMediaMeta['kind'];
  readonly mime: string;
  readonly size: number;
  readonly name?: string;
  readonly expiresAt: number;
  /** The signed address the inbound segment carries (`media.kind: 'url'`). */
  readonly url: string;
}

const NOT_FOUND_HEADERS = Object.freeze({ 'cache-control': 'no-store' });

/** The uploader / reader identity recorded in metadata and compared on inbound use. */
export function sandboxMediaActor(principal: ConsolePrincipal | undefined): string {
  return auditActor(principal);
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS });
}

function conversationFrom(url: URL, endpoint: string): SandboxMediaConversation | undefined {
  const type = url.searchParams.get('type');
  const id = url.searchParams.get('id');
  if ((type !== 'private' && type !== 'group' && type !== 'channel') || !id) return undefined;
  return { endpoint, type, id };
}

function sameConversation(a: SandboxMediaConversation, b: SandboxMediaConversation): boolean {
  return a.endpoint === b.endpoint && a.type === b.type && a.id === b.id;
}

/** RFC 6266 / 5987 `filename*`, plus an ASCII fallback with nothing that could break the header. */
function contentDisposition(meta: SandboxMediaMeta): string {
  const name = meta.name ?? meta.id;
  const ascii = name.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\;]/gu, '_');
  return `${meta.disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Served bytes: the sniffed type, `nosniff`, and no script context even when opened directly. */
function serve(store: SandboxMediaStore, meta: SandboxMediaMeta): Response {
  const headers: Record<string, string> = {
    'content-type': meta.disposition === 'inline' ? meta.mime : (meta.mime === 'text/plain' ? 'text/plain; charset=utf-8' : 'application/octet-stream'),
    'content-length': String(meta.size),
    'content-disposition': contentDisposition(meta),
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cross-origin-resource-policy': 'same-site',
    'cache-control': 'private, no-store',
  };
  return new Response(store.open(meta), { status: 200, headers });
}

function allowsEndpoint(principal: ConsolePrincipal | undefined, permission: string, endpoint: string): boolean {
  // An open local Host (no credentials configured) has no principal-scoped data to protect.
  if (!principal) return false;
  return principalAllows(principal, permission, Object.freeze({ kind: 'endpoint', adapter: 'sandbox', endpoint }));
}

function errorReply(error: SandboxMediaError): Response {
  return jsonResponse(error.status, { success: false, code: error.code, error: error.message });
}

function decodeFileName(header: string | null): string | undefined {
  if (!header) return undefined;
  try {
    return decodeURIComponent(header);
  } catch {
    throw new SandboxMediaError('invalid_name', 400, 'X-Zhin-File-Name must be URL-encoded');
  }
}

/** Mounts the routes of one endpoint; returns the unregister function. */
export function mountSandboxMediaRoutes(options: SandboxMediaRoutesOptions): () => void {
  const { http, store, logger } = options;
  const endpoint = store.endpointId;
  const base = sandboxMediaUploadPath(endpoint);
  const publicBase = `${SANDBOX_MEDIA_PUBLIC_PREFIX}${store.dirKey}`;
  const releases: Array<() => void> = [];

  const audit = (op: string, context: RouteContext, detail: Record<string, unknown>): void => {
    logger.warn(JSON.stringify({ op, endpoint, actor: sandboxMediaActor(context.principal),
      ...(context.remoteAddress ? { ip: context.remoteAddress } : {}), ...detail }));
  };

  const upload = async (request: Request, context: RouteContext): Promise<Response> => {
    if (!allowsEndpoint(context.principal, 'endpoint.operate', endpoint)) return jsonResponse(403, { success: false, code: 'forbidden', error: '缺少权限 endpoint.operate' });
    const conversation = conversationFrom(context.url, endpoint);
    if (!conversation) return jsonResponse(400, { success: false, code: 'invalid_conversation', error: 'type and id are required' });
    const declared = request.headers.get('content-length');
    const uploader = sandboxMediaActor(context.principal);
    try {
      const meta = await store.put({
        body: request.body,
        declaredLength: declared === null || !/^\d+$/u.test(declared) ? undefined : Number(declared),
        declaredType: request.headers.get('content-type') ?? undefined,
        fileName: decodeFileName(request.headers.get('x-zhin-file-name')),
        conversation,
        uploader,
        signal: request.signal,
      });
      const origin = http.address?.origin ?? context.url.origin;
      const reply: SandboxMediaUploadReply = {
        id: meta.id, kind: meta.kind, mime: meta.mime, size: meta.size, ...(meta.name ? { name: meta.name } : {}),
        expiresAt: meta.expiresAt, url: store.signedUrl(meta, origin),
      };
      // Audit line: who, where, what type and size; never the content or the file name.
      logger.info(JSON.stringify({ op: 'sandbox_media_uploaded', endpoint, actor: uploader, conversation: `${conversation.type}:${conversation.id}`,
        id: meta.id, kind: meta.kind, mime: meta.mime, size: meta.size }));
      return jsonResponse(201, { success: true, data: reply }, { 'cache-control': 'no-store' });
    } catch (error) {
      if (error instanceof SandboxMediaError) {
        if (error.status === 413 || error.status === 507) audit('sandbox_media_upload_refused', context, { code: error.code });
        return errorReply(error);
      }
      throw error;
    }
  };

  const consoleDownload = (_request: Request, context: RouteContext): Response => {
    const id = context.params['*'] ?? '';
    if (id.includes('/')) return notFound();
    if (!allowsEndpoint(context.principal, 'endpoint.view', endpoint)) return notFound();
    const meta = store.get(id);
    const conversation = conversationFrom(context.url, endpoint);
    if (!meta || !conversation) return notFound();
    if (!sameConversation(meta.conversation, conversation)) {
      audit('sandbox_media_conversation_mismatch', context, { id, requested: `${conversation.type}:${conversation.id}` });
      return notFound();
    }
    return serve(store, meta);
  };

  const remove = (_request: Request, context: RouteContext): Response => {
    const id = context.params['*'] ?? '';
    const meta = store.get(id);
    if (!meta || !allowsEndpoint(context.principal, 'endpoint.operate', endpoint)) return notFound();
    if (meta.uploader !== sandboxMediaActor(context.principal) && !isGlobalOwnerPrincipal(context.principal)) {
      audit('sandbox_media_delete_refused', context, { id });
      return jsonResponse(403, { success: false, code: 'forbidden', error: 'Only the uploader or an owner can delete this file' });
    }
    store.delete(id);
    logger.info(JSON.stringify({ op: 'sandbox_media_deleted', endpoint, actor: sandboxMediaActor(context.principal), id }));
    return jsonResponse(200, { success: true, data: { id, deleted: true } });
  };

  const secret = async (request: Request, context: RouteContext): Promise<Response> => {
    const principal = context.principal;
    const local = principal?.kind === 'bootstrap' && principal.open;
    if (!isGlobalOwnerPrincipal(principal) && !local) return jsonResponse(403, { success: false, code: 'forbidden', error: 'Only an owner can rotate the Sandbox media key' });
    const body = await request.json().catch(() => null) as { action?: unknown } | null;
    if (body?.action === 'rotate') store.rotate();
    else if (body?.action === 'revoke-all') store.revokeAll();
    else return jsonResponse(400, { success: false, code: 'invalid_action', error: 'action must be rotate or revoke-all' });
    logger.info(JSON.stringify({ op: 'sandbox_media_secret', endpoint, actor: sandboxMediaActor(principal), action: body.action }));
    return jsonResponse(200, { success: true, data: { action: body.action } });
  };

  const publicDownload = (_request: Request, context: RouteContext): Response => {
    if (!store.config.publicDownload) return notFound();
    const verified = store.verifyUrl(`${context.url.pathname}${context.url.search}`);
    return verified.ok ? serve(store, verified.meta) : notFound();
  };

  releases.push(
    http.route('POST', base, upload, { summary: 'Upload a Sandbox media file', tags: ['sandbox'] }),
    http.route('POST', `${base}/secret`, secret, { summary: 'Rotate or revoke the Sandbox media signing key', tags: ['sandbox'] }),
    http.route('GET', `${base}/*`, consoleDownload, { summary: 'Sandbox media file (Console)', tags: ['sandbox'] }),
    http.route('DELETE', `${base}/*`, remove, { summary: 'Delete (revoke) a Sandbox media file', tags: ['sandbox'] }),
    http.route('GET', `${publicBase}/*`, publicDownload, { summary: 'Signed Sandbox media link (off unless media.publicDownload)', tags: ['pub'] }),
  );
  return () => {
    for (const release of releases.splice(0)) release();
  };
}
