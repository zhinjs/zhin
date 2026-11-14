import type { HttpHost } from './http-host.js';
import { HttpBodyError, readJsonBody } from './json-body.js';
import { jsonResponse } from '@zhin.js/host-http-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('console');

/** Logs an unexpected failure server-side; clients only get a generic message. */
export function logInternalError(op: string, error: unknown): void {
  logger.warn(formatCompact({ op, error: error instanceof Error ? error.message : String(error) }));
}
import type {
  ConsoleAgentIntrospection,
  ConsoleAgentSessionTree,
  ConsoleRestCtx,
  ConsoleRestPagesOptions,
} from './console-rest-pages.js';

const INTROSPECTION_PAGE_SIZES = {
  commands: 25,
  middlewares: 30,
  components: 30,
  tools: 15,
  'prompt-sections': 20,
  endpoints: 30,
  bindings: 30,
  mcp: 30,
} as const;

type IntrospectionKind = keyof typeof INTROSPECTION_PAGE_SIZES;

/** Owning plugin of a capability row (`ConsoleIntrospectionOwner`, #1250): searchable by `q`. */
const OWNER_FIELDS: ReadonlyArray<(item: unknown) => string | undefined> = [
  (item) => stringProp(item, 'pluginInstance'),
  (item) => stringProp(item, 'pluginPackage'),
];

// ---------------------------------------------------------------------------
// Runtime snapshot introspection
// ---------------------------------------------------------------------------

export function registerIntrospectionRoutes(
  route: HttpHost['route'],
  base: string,
  ctx: ConsoleRestCtx,
  options: ConsoleRestPagesOptions,
): void {
  const collectors: Array<{
    kind: IntrospectionKind;
    collect: (introspection: ConsoleAgentIntrospection | undefined) => { rows: readonly unknown[]; note?: string };
    fields: Array<(item: unknown) => string | undefined>;
  }> = [
    {
      kind: 'commands',
      collect: (value) => ({ rows: value?.commands?.() ?? [] }),
      fields: [
        (c) => stringProp(c, 'pattern'),
        (c) => stringProp(c, 'desc'),
        (c) => stringProp(c, 'plugin'),
        ...OWNER_FIELDS,
      ],
    },
    {
      kind: 'middlewares',
      collect: (value) => ({ rows: value?.middlewares?.() ?? [] }),
      fields: [
        (m) => stringProp(m, 'name'),
        (m) => stringProp(m, 'owner'),
        (m) => stringProp(m, 'phase'),
        (m) => stringProp(m, 'target'),
        (m) => stringProp(m, 'source'),
        ...OWNER_FIELDS,
      ],
    },
    {
      kind: 'components',
      collect: (value) => ({ rows: value?.components?.() ?? [] }),
      fields: [
        (c) => stringProp(c, 'name'),
        (c) => stringProp(c, 'owner'),
        (c) => stringProp(c, 'source'),
        ...OWNER_FIELDS,
      ],
    },
    {
      kind: 'endpoints',
      collect: () => ({
        rows: (ctx.getEndpoints?.() ?? []).map((endpoint) => ({
          adapter: endpoint.adapter,
          name: endpoint.name,
          online: endpoint.connected,
          status: endpoint.status,
        })),
      }),
      fields: [(b) => stringProp(b, 'adapter'), (b) => stringProp(b, 'name')],
    },
    {
      kind: 'bindings',
      collect: (value) => ({ rows: value?.bindings?.() ?? [] }),
      fields: [
        (a) => stringProp(a, 'name'),
        (a) => stringProp(a, 'provider'),
        (a) => stringProp(a, 'model'),
      ],
    },
    {
      kind: 'tools',
      collect: (value) => ({ rows: value?.tools?.() ?? [] }),
      fields: [
        (t) => stringProp(t, 'name'),
        (t) => stringProp(t, 'source'),
        (t) => stringProp(t, 'description'),
        ...OWNER_FIELDS,
      ],
    },
    {
      kind: 'prompt-sections',
      collect: (value) => ({ rows: value?.promptSections?.() ?? [] }),
      fields: [
        (section) => stringProp(section, 'name'),
        (section) => stringProp(section, 'qualifiedName'),
        (section) => stringProp(section, 'title'),
        (section) => stringProp(section, 'owner'),
        (section) => stringProp(section, 'layer'),
        (section) => stringProp(section, 'retention'),
        (section) => stringProp(section, 'source'),
        ...OWNER_FIELDS,
      ],
    },
    {
      kind: 'mcp',
      collect: (value) => {
        const result = value?.mcp?.();
        if (result == null) return { rows: [] as readonly unknown[] };
        // readonly 数组不能用 Array.isArray 收窄，按对象形状判断
        if (typeof result === 'object' && 'rows' in result) {
          return { rows: result.rows, note: result.note };
        }
        return { rows: result as readonly unknown[] };
      },
      fields: [(s) => stringProp(s, 'name')],
    },
  ];

  for (const { kind, collect, fields } of collectors) {
    route('GET', `${base}/introspection/${kind}`, async (_request, { url }) => {
      const lease = kind === 'endpoints' ? null : ctx.acquireAgentRuntime?.() ?? null;
      try {
        const introspection = lease?.value.introspection;
        const { rows, note } = collect(introspection);
        const query = url.searchParams;
        const filter = query.get('filter')?.trim() || undefined;
        const filtered = filterByFields([...rows], filter, fields);
        const slice = paginateItems(
          filtered,
          parsePositiveInt(query.get('page'), 1),
          parsePositiveInt(query.get('pageSize'), INTROSPECTION_PAGE_SIZES[kind]),
        );
        const missing = kind === 'endpoints'
          ? !ctx.getEndpoints
          : !introspection;
        const degradedNote = note ?? (missing
          ? kind === 'endpoints'
            ? 'Endpoints 数据源未接线（ctx.getEndpoints 缺失）'
            : 'Agent runtime 未装配（basic/cli 未接线 acquireAgentRuntime）'
          : undefined);
        return jsonResponse(200, {
          success: true,
          data: { ...slice, filter, note: degradedNote },
        });
      } catch (err) {
        logInternalError(`introspection_${kind}_failed`, err);
        return jsonResponse(503, {
          success: false,
          data: { items: [], page: 1, pageSize: 0, total: 0, totalPages: 0 },
          error: 'Introspection unavailable',
        });
      } finally {
        lease?.release();
      }
    }, { summary: `Introspection: ${kind}`, tags: ['console', 'introspection'] });
  }

  let activeComponentPreviews = 0;
  route('POST', `${base}/introspection/components/render`, async (request) => {
    const denied = requireWriteScope(ctx);
    if (denied) return denied;
    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    const requester = typeof body.requester === 'string' ? body.requester.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!requester || !name || requester.length > 256 || name.length > 160) {
      return jsonResponse(400, { success: false, error: '请提供有效的 requester 与 component name' });
    }
    const maxConcurrent = clampPositiveInt(options.componentPreviewMaxConcurrent, 2, 8);
    if (activeComponentPreviews >= maxConcurrent) {
      return jsonResponse(503, { success: false, error: 'Component preview 正忙，请稍后重试' });
    }
    const lease = ctx.acquireAgentRuntime?.();
    const render = lease?.value.introspection?.renderComponent;
    const previewDelivery = lease?.value.introspection?.previewComponentDelivery;
    if (!lease || !render) {
      lease?.release();
      return jsonResponse(503, { success: false, error: 'Component Runtime 未就绪' });
    }
    const controller = new AbortController();
    const timeoutMs = clampPositiveInt(options.componentPreviewTimeoutMs, 5_000, 30_000);
    const timeout = setTimeout(() => controller.abort(
      new ComponentPreviewTimeoutError(`Component preview 超过 ${timeoutMs}ms`),
    ), timeoutMs);
    activeComponentPreviews += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeComponentPreviews -= 1;
      lease.release();
    };
    const renderPromise = Promise.resolve().then(() => {
      const input = { requester, name, props: body.props ?? {}, signal: controller.signal };
      if (body.target === undefined) return render(input).then(output => ({ output }));
      if (!previewDelivery) throw new Error('Target-aware Component preview 未就绪');
      return previewDelivery({ ...input, target: body.target });
    });
    // A timed-out implementation may ignore AbortSignal. Keep its generation
    // lease until the real operation settles; the bounded concurrency gate
    // prevents non-cooperative previews from pinning unbounded generations.
    void renderPromise.then(release, release);
    try {
      const preview = await raceWithAbort(
        renderPromise,
        controller.signal,
      );
      assertPreviewOutput(preview, options.componentPreviewMaxBytes ?? 256 * 1024);
      return jsonResponse(200, { success: true, data: { requester, name, ...preview } });
    } catch (error) {
      const status = error instanceof ComponentPreviewTimeoutError
        ? 408
        : error instanceof ComponentPreviewLimitError ? 413 : 422;
      // Timeout / size limit messages are ours; a component's own failure detail stays in the log.
      const known = error instanceof ComponentPreviewTimeoutError || error instanceof ComponentPreviewLimitError;
      if (!known) logInternalError('component_preview_failed', error);
      return jsonResponse(status, {
        success: false,
        error: known ? (error as Error).message : 'Component preview failed',
      });
    } finally {
      clearTimeout(timeout);
      if (!controller.signal.aborted) controller.abort();
    }
  }, { summary: 'Render a Component preview', tags: ['console', 'introspection', 'component'] });
}

class ComponentPreviewTimeoutError extends Error {
  override readonly name = 'ComponentPreviewTimeoutError';
}

class ComponentPreviewLimitError extends Error {
  override readonly name = 'ComponentPreviewLimitError';
}

export function clampPositiveInt(value: number | undefined, fallback: number, ceiling: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.min(Math.floor(value), ceiling);
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Component preview aborted', 'AbortError');
}

function assertPreviewOutput(output: unknown, maxBytes: number): void {
  const byteLimit = clampPositiveInt(maxBytes, 256 * 1024, 1024 * 1024);
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 10_000) throw new ComponentPreviewLimitError('Component preview 节点数超过 10000');
    if (depth > 24) throw new ComponentPreviewLimitError('Component preview 嵌套深度超过 24');
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) throw new ComponentPreviewLimitError('Component preview 不能包含循环引用');
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    } else {
      for (const item of Object.values(value as Record<string, unknown>)) visit(item, depth + 1);
    }
  };
  visit(output, 0);
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch (error) {
    throw new ComponentPreviewLimitError(
      `Component preview 无法序列化: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (Buffer.byteLength(serialized ?? '') > byteLimit) {
    throw new ComponentPreviewLimitError(`Component preview 超过 ${byteLimit} bytes`);
  }
}

// ---------------------------------------------------------------------------
// agent sessions（legacy agent-sessions-rest-api.ts；ADR 0010 D3）
// ---------------------------------------------------------------------------

export function registerAgentSessionRoutes(
  route: HttpHost['route'],
  base: string,
  ctx: ConsoleRestCtx,
): void {
  const prefix = `${base}/agent/sessions/`;
  const acquireSessionTree = (): {
    readonly tree: ConsoleAgentSessionTree;
    release(): void;
  } | null => {
    const lease = ctx.acquireAgentRuntime?.();
    const tree = lease?.value.sessionTree;
    if (!lease || !tree || typeof tree.resolveActiveSessionId !== 'function') {
      lease?.release();
      return null;
    }
    return { tree, release: () => lease.release() };
  };
  const unavailable = (headers?: HeadersInit) => {
    return jsonResponse(503, {
      success: false,
      error: 'Agent session tree runtime 未就绪（新 Runtime 需经 acquireAgentRuntime 装配 sessionTree）',
    }, headers);
  };

  // HttpHost 无 `:param` 路由，用前缀路由匹配 `<sessionKey>/tree|message|leaf`。
  route('GET', `${base}/agent/sessions/*`, async (_request, { url }) => {
    const messageAction = parseSessionAction(url.pathname, prefix, 'message');
    const headers: HeadersInit | undefined = messageAction ? { 'cache-control': 'no-store' } : undefined;
    const reply = (status: number, body: unknown) => jsonResponse(status, body, headers);
    const parsed = messageAction ?? parseSessionAction(url.pathname, prefix, 'tree');
    if (!parsed) {
      return reply(404, { success: false, error: 'Not found' });
    }
    const messageId = Number(url.searchParams.get('messageId'));
    const expectedSessionId = url.searchParams.get('sessionId');
    if (messageAction && (!Number.isSafeInteger(messageId) || messageId < 1 || !expectedSessionId)) {
      return reply(400, { success: false, error: '需要 sessionId 和正安全整数 messageId' });
    }
    const lease = acquireSessionTree();
    if (!lease) {
      return unavailable(headers);
    }
    const runtime = lease.tree;
    try {
      if (messageAction && !runtime.readBranchMessage) {
        return reply(501, { success: false, error: '当前 Agent runtime 不支持读取完整消息' });
      }
      const sessionId = await runtime.resolveActiveSessionId(parsed.sessionKey);
      if (messageAction) {
        if (!sessionId) {
          return reply(404, { success: false, error: '未找到活跃会话' });
        }
        if (sessionId !== expectedSessionId) {
          return reply(409, { success: false, error: '会话已变化，请重新读取会话列表' });
        }
        const text = await runtime.readBranchMessage!(sessionId, messageId);
        if (text === null) {
          return reply(404, { success: false, error: '未找到此会话的用户消息' });
        }
        return reply(200, { success: true, data: { messageId, text } });
      }
      if (!sessionId) {
        if (!isRuntimeImSessionKey(parsed.sessionKey)) {
          return reply(404, {
            success: false,
            error: `未找到会话：${parsed.sessionKey}`,
          });
        }
        const knownConversation = await ctx.isKnownConversationSession?.(parsed.sessionKey);
        if (knownConversation === false) {
          return reply(404, {
            success: false,
            error: `未找到会话：${parsed.sessionKey}`,
          });
        }
        // 渠道会话与 Agent 会话的生命周期不同：用户可以先在 Console
        // 选中一个真实渠道会话，而该会话尚未触发过 Agent。树查询是只读操作，
        // 因而将这种正常状态返回为可渲染空态，而不是误报资源不存在。
        return reply(200, {
          success: true,
          data: {
            state: 'not_started',
            sessionKey: parsed.sessionKey,
            sessionId: null,
            activeLeafMessageId: null,
            points: [],
          },
        });
      }

      const activeLeafMessageId = await runtime.getActiveLeafMessageId(sessionId);
      const points = await runtime.listBranchPoints(sessionId);
      return reply(200, {
        success: true,
        data: {
          state: 'active',
          sessionKey: parsed.sessionKey,
          sessionId,
          activeLeafMessageId,
          points,
        },
      });
    } finally {
      lease.release();
    }
  }, { summary: 'Get agent session tree or message', tags: ['console', 'agent'] });

  route('POST', `${base}/agent/sessions/*`, async (request, { url }) => {
    const parsed = parseSessionAction(url.pathname, prefix, 'leaf');
    if (!parsed) {
      return jsonResponse(404, { success: false, error: 'Not found' });
    }
    const denied = requireWriteScope(ctx);
    if (denied) return denied;
    let body: Record<string, unknown>;
    try {
      body = (await readJsonBody(request) ?? {}) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof HttpBodyError) {
        return jsonResponse(error.statusCode, { success: false, error: error.message });
      }
      throw error;
    }
    const messageIdRaw = body.messageId;
    const indexRaw = body.index;
    let messageId: number | undefined;
    let branchIndex: number | undefined;
    if (messageIdRaw != null && messageIdRaw !== '') {
      const value = Number(messageIdRaw);
      if (!Number.isFinite(value) || value < 1) {
        return jsonResponse(400, { success: false, error: 'messageId 须为正整数' });
      }
      messageId = value;
    } else if (indexRaw != null && indexRaw !== '') {
      const value = Number(indexRaw);
      if (!Number.isFinite(value) || value < 1) {
        return jsonResponse(400, { success: false, error: 'index 须为正整数' });
      }
      branchIndex = value;
    } else {
      return jsonResponse(400, { success: false, error: '需要 messageId 或 index 之一' });
    }

    const lease = acquireSessionTree();
    if (!lease) {
      return unavailable();
    }
    const runtime = lease.tree;
    try {
      const sessionId = await runtime.resolveActiveSessionId(parsed.sessionKey);
      if (!sessionId) {
        return jsonResponse(404, {
          success: false,
          error: `未找到活跃会话：${parsed.sessionKey}`,
        });
      }

      if (branchIndex !== undefined) {
        const result = await runtime.jumpToBranchIndex(sessionId, branchIndex);
        const activeLeafMessageId = await runtime.getActiveLeafMessageId(sessionId);
        return jsonResponse(result.ok ? 200 : 400, {
          success: result.ok,
          message: result.message,
          data: {
            sessionKey: parsed.sessionKey,
            sessionId,
            activeLeafMessageId,
          },
        });
      }

      const ok = await runtime.switchActiveLeaf(sessionId, messageId!);
      const activeLeafMessageId = await runtime.getActiveLeafMessageId(sessionId);
      return jsonResponse(ok ? 200 : 400, {
        success: ok,
        message: ok ? `已切换 active leaf 至消息 #${messageId}` : '切换失败',
        data: {
          sessionKey: parsed.sessionKey,
          sessionId,
          activeLeafMessageId,
        },
      });
    } finally {
      lease.release();
    }
  }, { summary: 'Switch agent session active leaf', tags: ['console', 'agent'] });
}

/** Runtime IM session keys are `<platform>:<endpoint>:<scope>:<sceneId>`. */
function isRuntimeImSessionKey(value: string): boolean {
  const first = value.indexOf(':');
  const second = value.indexOf(':', first + 1);
  const third = value.indexOf(':', second + 1);
  return first > 0
    && second > first + 1
    && third > second + 1
    && third < value.length - 1;
}

function parseSessionAction(
  pathname: string,
  prefix: string,
  action: 'tree' | 'message' | 'leaf',
): { sessionKey: string } | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/+$/u, '');
  const suffix = `/${action}`;
  if (!rest.endsWith(suffix)) return null;
  const rawKey = rest.slice(0, -suffix.length);
  if (!rawKey) return null;
  return { sessionKey: decodePathParam(rawKey) };
}

// ---------------------------------------------------------------------------
// 内部分页 / 过滤
// ---------------------------------------------------------------------------

export function paginateItems<T>(
  all: T[],
  page: number,
  pageSize: number,
): { items: T[]; page: number; pageSize: number; total: number; totalPages: number } {
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: all.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

export function filterByFields<T>(
  items: T[],
  filter: string | undefined,
  fields: Array<(item: T) => string | undefined>,
): T[] {
  if (!filter?.trim()) return items;
  return items.filter((item) => {
    const blob = fields
      .map((f) => f(item) ?? '')
      .join(' ')
      .toLowerCase();
    return blob.includes(filter.trim().toLowerCase());
  });
}

export function stringProp(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const prop = (value as Record<string, unknown>)[key];
  return typeof prop === 'string' ? prop : undefined;
}

export function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw && /^\d+$/u.test(raw)) return Math.max(1, parseInt(raw, 10));
  return fallback;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 写操作门禁：demo 部署（ctx.fullScope=false）返回 403 响应，放行时返回 undefined。 */
export function requireWriteScope(ctx: ConsoleRestCtx): Response | undefined {
  if (ctx.fullScope) return undefined;
  return jsonResponse(403, {
    success: false,
    error: 'Demo scope: 只读访问，写操作被拒绝',
  });
}

export function decodePathParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function trimTrailingSlashes(s: string): string {
  let i = s.length;
  while (i > 0 && s[i - 1] === '/') i--;
  return s.slice(0, i);
}

export function normalizeBase(value: string): string {
  if (!value.startsWith('/')) return `/${value}`;
  return trimTrailingSlashes(value) || '/api';
}
