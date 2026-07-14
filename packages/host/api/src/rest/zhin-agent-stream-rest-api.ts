/**
 * Zhin Agent session HTTP API — ADR 0039 P0 / ADR 0041 Host port injection.
 *
 * POST /zhin/v1/session
 * POST /zhin/v1/session/:sessionId
 * GET  /zhin/v1/session/:sessionId/stream
 * GET  /zhin/v1/health
 */
import { Readable } from 'node:stream';
import type { AgentSessionHostPort } from '@zhin.js/agent';
import type { HttpAgentSessionStore } from '@zhin.js/agent';
import { completeConnectionAuthorization } from '@zhin.js/agent/connection';
import {
  AGENT_STREAM_MEDIA_TYPE,
  AgentStreamEventType,
  formatAgentStreamNdjsonLine,
  ZHIN_SESSION_ID_HEADER,
  type AgentStreamEvent,
} from '@zhin.js/contract';
import {
  firstQuery,
  registerFetchRoute,
  type Router,
  type RouterContext,
} from '@zhin.js/host-router/router';

function parseStartIndex(ctx: RouterContext): number {
  const raw = firstQuery(ctx, 'startIndex');
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function writeNdjsonStream(
  ctx: RouterContext,
  sessionId: string,
  startIndex: number,
  store: HttpAgentSessionStore,
  session: NonNullable<ReturnType<HttpAgentSessionStore['getSession']>>,
): void {

  ctx.status = 200;
  ctx.set('Content-Type', AGENT_STREAM_MEDIA_TYPE);
  ctx.set('Cache-Control', 'no-cache, no-transform');
  ctx.set('Connection', 'keep-alive');
  ctx.set('X-Accel-Buffering', 'no');
  ctx.set(ZHIN_SESSION_ID_HEADER, sessionId);

  let nextIndex = startIndex;
  let closed = false;

  const body = new Readable({
    read() {
      /* push-driven */
    },
  });

  const pushEvent = (event: AgentStreamEvent) => {
    if (closed || body.destroyed) return;
    body.push(formatAgentStreamNdjsonLine(event));
  };

  const replay = store.listEventSlice(sessionId, startIndex);
  for (const event of replay) {
    pushEvent(event);
    nextIndex += 1;
  }

  const unsubscribe = store.subscribe(sessionId, (event, index) => {
    if (index < nextIndex) return;
    nextIndex = index + 1;
    pushEvent(event);
    if (
      event.type === AgentStreamEventType.SESSION_WAITING
      || event.type === AgentStreamEventType.SESSION_COMPLETED
      || event.type === AgentStreamEventType.SESSION_FAILED
    ) {
      if (!body.destroyed) body.push(null);
    }
  });

  if (
    session.status === 'waiting'
    || session.status === 'completed'
    || session.status === 'failed'
  ) {
    if (!body.destroyed) body.push(null);
  }

  const onClientClose = () => {
    closed = true;
    unsubscribe();
    if (!body.destroyed) body.destroy();
  };

  ctx.req.once('close', onClientClose);
  body.once('close', () => {
    ctx.req.off('close', onClientClose);
    unsubscribe();
  });
  body.on('error', () => {
    /* client disconnect */
  });

  ctx.body = body;
}

export function registerZhinAgentStreamRoutes(
  router: Router,
  base: string,
  port: AgentSessionHostPort | null | undefined,
): void {
  registerFetchRoute(router, 'GET', `${base}/health`, (ctx: RouterContext) => {
    ctx.status = 200;
    ctx.body = { ok: true, service: 'zhin-agent-session' };
  });

  registerFetchRoute(router, 'GET', `${base}/info`, async (ctx: RouterContext) => {
    try {
      const { buildAgentSurfaceInfoReport } = await import('@zhin.js/agent');
      const cwd = firstQuery(ctx, 'cwd') ?? process.cwd();
      ctx.status = 200;
      ctx.body = { ok: true, report: await buildAgentSurfaceInfoReport(cwd) };
    } catch {
      ctx.status = 503;
      ctx.body = { ok: false, error: 'AGENT_SURFACE_INFO_UNAVAILABLE' };
    }
  });

  registerFetchRoute(router, 'POST', `${base}/session`, async (ctx: RouterContext) => {
    if (!port) {
      ctx.status = 503;
      ctx.body = { ok: false, error: 'HTTP agent session runtime 未就绪' };
      return;
    }

    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      ctx.status = 400;
      ctx.body = { ok: false, error: 'message 必填' };
      return;
    }

    const { sessionId, continuationToken } = await port.store.startSession(message);
    ctx.status = 200;
    ctx.set(ZHIN_SESSION_ID_HEADER, sessionId);
    ctx.body = { ok: true, sessionId, continuationToken };
  });

  registerFetchRoute(router, 'POST', `${base}/session/:sessionId`, async (ctx: RouterContext) => {
    if (!port) {
      ctx.status = 503;
      ctx.body = { ok: false, error: 'HTTP agent session runtime 未就绪' };
      return;
    }

    const sessionId = ctx.params.sessionId;
    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const continuationToken = typeof body.continuationToken === 'string' ? body.continuationToken : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!continuationToken || !message) {
      ctx.status = 400;
      ctx.body = { ok: false, error: 'continuationToken 与 message 必填' };
      return;
    }

    const result = await port.store.continueSession(sessionId, continuationToken, message);
    if (!result.ok) {
      const status = result.error === 'SESSION_NOT_FOUND' ? 404
        : result.error === 'CONTINUATION_TOKEN_STALE' ? 409
          : result.error === 'SESSION_BUSY' ? 409
            : 400;
      ctx.status = status;
      ctx.body = { ok: false, error: result.error };
      return;
    }

    ctx.status = 200;
    ctx.set(ZHIN_SESSION_ID_HEADER, sessionId);
    ctx.body = { ok: true, sessionId, continuationToken: result.continuationToken };
  });

  registerFetchRoute(router, 'GET', `${base}/session/:sessionId/stream`, async (ctx: RouterContext) => {
    if (!port) {
      ctx.status = 503;
      ctx.body = { ok: false, error: 'HTTP agent session runtime 未就绪' };
      return;
    }
    const sessionId = ctx.params.sessionId;
    const session = port.store.getSession(sessionId)
      ?? await port.store.hydrateSession(sessionId);
    if (!session) {
      ctx.status = 404;
      ctx.body = { ok: false, error: 'SESSION_NOT_FOUND' };
      return;
    }
    writeNdjsonStream(ctx, sessionId, parseStartIndex(ctx), port.store, session);
  });

  registerFetchRoute(router, 'POST', `${base}/session/:sessionId/input`, async (ctx: RouterContext) => {
    if (!port) {
      ctx.status = 503;
      ctx.body = { ok: false, error: 'HTTP agent session runtime 未就绪' };
      return;
    }

    const sessionId = ctx.params.sessionId;
    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const approved = body.approved === true;

    if (!requestId) {
      ctx.status = 400;
      ctx.body = { ok: false, error: 'requestId 必填' };
      return;
    }

    const result = await port.store.submitInput(sessionId, requestId, approved);
    if (!result.ok) {
      const status = result.error === 'SESSION_NOT_FOUND' ? 404 : 404;
      ctx.status = status;
      ctx.body = { ok: false, error: result.error };
      return;
    }

    ctx.status = 200;
    ctx.set(ZHIN_SESSION_ID_HEADER, sessionId);
    ctx.body = { ok: true, sessionId, requestId, approved };
  });

  registerFetchRoute(router, 'POST', `${base}/authorization/:requestId/complete`, (ctx: RouterContext) => {
    const requestId = ctx.params.requestId;
    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const success = body.success === true;
    const error = typeof body.error === 'string' ? body.error : undefined;
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;

    const onStreamEvent = (event: AgentStreamEvent) => {
      if (sessionId && port) {
        void port.publishHttpSessionEvent(sessionId, event);
      }
    };

    const ok = completeConnectionAuthorization(requestId, { success, error }, onStreamEvent);
    if (!ok) {
      ctx.status = 404;
      ctx.body = { ok: false, error: 'AUTHORIZATION_REQUEST_NOT_FOUND' };
      return;
    }
    ctx.status = 200;
    ctx.body = { ok: true, requestId, success };
  });
}
