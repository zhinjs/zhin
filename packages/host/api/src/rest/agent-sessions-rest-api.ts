/**
 * Agent session tree REST — ADR 0010 D3 Console API.
 *
 * GET  /api/agent/sessions/:sessionKey/tree
 * POST /api/agent/sessions/:sessionKey/leaf
 */
import { getSessionTreeRuntime } from '@zhin.js/agent';
import {
  registerFetchRoute,
  type Router,
  type RouterContext,
} from '@zhin.js/host-router/router';

function decodeSessionKey(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function registerAgentSessionsRoutes(router: Router, base: string): void {
  registerFetchRoute(router, 'GET', `${base}/agent/sessions/:sessionKey/tree`, async (ctx: RouterContext) => {
    const runtime = getSessionTreeRuntime();
    if (!runtime) {
      ctx.status = 503;
      ctx.body = { success: false, error: 'Agent session tree runtime 未就绪' };
      return;
    }

    const sessionKey = decodeSessionKey(ctx.params.sessionKey);
    const sessionId = await runtime.resolveActiveSessionId(sessionKey);
    if (!sessionId) {
      ctx.status = 404;
      ctx.body = { success: false, error: `未找到活跃会话：${sessionKey}` };
      return;
    }

    const session = await runtime.agentSessionStore.getBySessionId(sessionId);
    const points = await runtime.listBranchPoints(sessionId);
    ctx.status = 200;
    ctx.body = {
      success: true,
      data: {
        sessionKey,
        sessionId,
        activeLeafMessageId: session?.active_leaf_message_id ?? null,
        points,
      },
    };
  });

  registerFetchRoute(router, 'POST', `${base}/agent/sessions/:sessionKey/leaf`, async (ctx: RouterContext) => {
    const runtime = getSessionTreeRuntime();
    if (!runtime) {
      ctx.status = 503;
      ctx.body = { success: false, error: 'Agent session tree runtime 未就绪' };
      return;
    }

    const sessionKey = decodeSessionKey(ctx.params.sessionKey);
    const sessionId = await runtime.resolveActiveSessionId(sessionKey);
    if (!sessionId) {
      ctx.status = 404;
      ctx.body = { success: false, error: `未找到活跃会话：${sessionKey}` };
      return;
    }

    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const messageIdRaw = body.messageId;
    const indexRaw = body.index;

    let messageId: number | undefined;
    if (messageIdRaw != null && messageIdRaw !== '') {
      const n = Number(messageIdRaw);
      if (!Number.isFinite(n) || n < 1) {
        ctx.status = 400;
        ctx.body = { success: false, error: 'messageId 须为正整数' };
        return;
      }
      messageId = n;
    } else if (indexRaw != null && indexRaw !== '') {
      const index = Number(indexRaw);
      if (!Number.isFinite(index) || index < 1) {
        ctx.status = 400;
        ctx.body = { success: false, error: 'index 须为正整数' };
        return;
      }
      const result = await runtime.jumpToBranchIndex(sessionId, index);
      const session = await runtime.agentSessionStore.getBySessionId(sessionId);
      ctx.status = result.ok ? 200 : 400;
      ctx.body = {
        success: result.ok,
        message: result.message,
        data: {
          sessionKey,
          sessionId,
          activeLeafMessageId: session?.active_leaf_message_id ?? null,
        },
      };
      return;
    } else {
      ctx.status = 400;
      ctx.body = { success: false, error: '需要 messageId 或 index 之一' };
      return;
    }

    const ok = await runtime.switchActiveLeaf(sessionId, messageId);
    const session = await runtime.agentSessionStore.getBySessionId(sessionId);
    ctx.status = ok ? 200 : 400;
    ctx.body = {
      success: ok,
      message: ok ? `已切换 active leaf 至消息 #${messageId}` : '切换失败',
      data: {
        sessionKey,
        sessionId,
        activeLeafMessageId: session?.active_leaf_message_id ?? null,
      },
    };
  });
}
