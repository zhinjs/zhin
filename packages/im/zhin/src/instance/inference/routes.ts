import {
  auditActor,
  HttpBodyError,
  isGlobalOwnerPrincipal,
  isLocalSocketPrincipal,
  isUserPrincipal,
  jsonResponse,
  readJsonBody,
  type AuthScope,
  type ConsoleAuditEntry,
  type ConsolePrincipal,
  type HttpHost,
} from '@zhin.js/host-http';
import { withNoStore } from '../console/no-store.js';
import { preparationHint } from '../console/attention.js';
import type { ConsoleErrorDetails, ConsoleErrorNextStep } from '@zhin.js/console-protocol';

/** The authenticated Console user behind a request, as the management principal id. */
function principalId(principal: ConsolePrincipal | undefined): { principalId?: string } {
  return isUserPrincipal(principal) ? { principalId: `user:${principal.userId}` } : {};
}
import { ProviderDiscoveryError, ProviderError } from '@zhin.js/ai/provider';
import {
  PersonalSessionAccessError,
  PersonalSessionMigrationRequiredError,
  PersonalSessionRevisionConflictError,
  type PersonalSessionOwner,
} from '@zhin.js/agent/personal-session';
import { HostAccountRuntime } from '@zhin.js/agent/runtime';
import { InferenceAuthenticationError } from '@zhin.js/agent/runtime';
import { InferenceStoreError } from '@zhin.js/agent/runtime';
import {
  INFERENCE_ENVIRONMENT_REFUSALS,
  InferenceManagementError,
  InferenceApplyRejectedError,
  type InferenceEnvironmentAuthority,
  type InferenceManagementPrincipal,
  type InferenceManagementService,
  type InferenceProbeResult,
} from '@zhin.js/agent/runtime';
import type { InferenceTargetsReader } from '@zhin.js/agent/runtime';
import type { InferenceSessionManagement } from '@zhin.js/agent/runtime';

export interface InferenceManagementLease {
  readonly management: InferenceManagementService;
  readonly accounts: HostAccountRuntime;
  readonly sessions: InferenceSessionManagement;
  readonly targets?: InferenceTargetsReader;
  readonly authenticationContract: (accountId: string) => Promise<string>;
  readonly probe?: (input: Readonly<{ profileId: string; signal: AbortSignal }>) => Promise<InferenceProbeResult>;
  release(): void | Promise<void>;
}

/** Which Host environment variables the Console / CLI caller may reference (#1250). */
export function inferenceEnvironmentAuthority(principal: ConsolePrincipal | undefined): InferenceEnvironmentAuthority {
  if (isLocalSocketPrincipal(principal)) return 'local-cli';
  if (isGlobalOwnerPrincipal(principal)) return 'console-owner';
  return 'none';
}
/** `/probe` and `/account/test` were called too often for one account (#1250). */
export class ConnectionTestRateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('Connection test rate limited');
    this.name = 'ConnectionTestRateLimitedError';
  }
}

/** Default connection-test budget per account: 6 per minute. */
export const CONNECTION_TEST_RATE_LIMIT = Object.freeze({ limit: 6, windowMs: 60_000 });

/**
 * Sliding-window limiter keyed by account: every connection test is a real (billed) model request,
 * so one account cannot be probed in a loop through the Console or CLI.
 */
export function createConnectionTestLimiter(
  options: Readonly<{ limit?: number; windowMs?: number; now?: () => number }> = {},
): (key: string) => void {
  const limit = options.limit ?? CONNECTION_TEST_RATE_LIMIT.limit;
  const windowMs = options.windowMs ?? CONNECTION_TEST_RATE_LIMIT.windowMs;
  const now = options.now ?? Date.now;
  const calls = new Map<string, number[]>();
  return (key: string) => {
    const at = now();
    for (const [other, times] of calls) {
      const kept = times.filter(time => at - time < windowMs);
      if (kept.length) calls.set(other, kept); else calls.delete(other);
    }
    const recent = calls.get(key) ?? [];
    if (recent.length >= limit) throw new ConnectionTestRateLimitedError(Math.max(1, recent[0]! + windowMs - at));
    calls.set(key, [...recent, at]);
  };
}

export interface InferenceRouteOptions {
  /** Connection-test budget per account (`/probe`, `/account/test`); default {@link CONNECTION_TEST_RATE_LIMIT}. */
  readonly connectionTestRateLimit?: Readonly<{ limit?: number; windowMs?: number; now?: () => number }>;
  readonly http: HttpHost;
  readonly base: string;
  readonly acquire: () => InferenceManagementLease;
  /** Uses static administrator bindings. The returned owner is not supplied by a model or HTTP payload. */
  readonly principal: (
    input: Readonly<{
      scope: AuthScope;
      principalId?: string;
      requestedOwner?: string;
    }>
  ) => InferenceManagementPrincipal;
  readonly owners: (
    input: Readonly<{ scope: AuthScope; principalId?: string }>
  ) => readonly InferenceOwnerView[];
  /** Console audit sink; entries carry ids and variable names, never values. */
  readonly audit?: (entry: ConsoleAuditEntry) => void;
}
export interface InferenceOwnerView {
  readonly id: string;
  readonly label: string;
  readonly kind: 'host' | 'personal';
  readonly personal?: PersonalSessionOwner;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InferenceManagementError('invalid-input');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new InferenceManagementError('invalid-input');
  return value;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new InferenceManagementError('invalid-input');
  return Number(value);
}
/** Actionable text for refusals the Console user can resolve; other failures stay generic. */
const FAILURE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  'service-origin-change':
    '已有账号在用这个服务，服务地址只能改路径（例如补上 /v1），不能换主机、协议或端口：账号的密钥只会发往原来的主机。'
    + '要换主机，请用「复制为新服务」新建一个服务，再把账号和用途迁移过去。',
});
function failureMessage(code: string): string {
  return FAILURE_MESSAGES[code] ?? '模型服务操作未完成';
}
interface RouteFailure {
  readonly status: number;
  readonly code: string;
  /** Safe, enum-like diagnostics only (driver step, upstream HTTP status and reason code). */
  readonly details?: Readonly<{ preparationCode?: string; reason?: string; upstreamStatus?: number; step?: string; retryAfterMs?: number;
    /** Offending configuration path, e.g. `purposes.adapters.qq.chat.fallbacks[1]` (#1250). */
    path?: string }>;
  /** Operator-facing text replacing the generic one when the failure is actionable. */
  readonly message?: string;
  /** What the operator can do next (#1270); `ConsoleErrorNextStep` of `@zhin.js/console-protocol`. */
  readonly nextStep?: ConsoleErrorNextStep;
  /** Why an environment reference was refused (#1250); its text is {@link INFERENCE_ENVIRONMENT_REFUSALS}. */
  readonly reason?: keyof typeof INFERENCE_ENVIRONMENT_REFUSALS;
}
/** Console action ids of {@link ConsoleErrorNextStep} used by the inference routes (#1270). */
const NEXT_STEPS = Object.freeze({
  login: { kind: 'action', action: 'login', label: '重新登录该模型账号' },
  retry: { kind: 'action', action: 'retry', label: '稍后重试' },
  setProjectId: { kind: 'action', action: 'set-project-id', label: '在模型服务配置中填写 Google Cloud 项目 ID（projectId）' },
  setClientSecret: { kind: 'action', action: 'set-client-secret', label: '为账号设置 OAuth 客户端凭据（client secret）' },
  verifyAccount: { kind: 'action', action: 'verify-account', label: '先在浏览器中完成 Google 账号验证，再完成准备' },
  editConfig: { kind: 'action', action: 'edit-config', label: '修正对应的模型配置' },
  reload: { kind: 'action', action: 'reload', label: '重新读取后再提交' },
} as const satisfies Record<string, ConsoleErrorNextStep>);

/** Next step of a preparation failure, by its sanitized reason (same split as the attention hint). */
function preparationNextStep(preparation: Readonly<{ reason?: string; status?: number }> | undefined): ConsoleErrorNextStep {
  const hint = preparationHint({ ...(preparation?.reason ? { reason: preparation.reason } : {}),
    ...(preparation?.status === undefined ? {} : { upstreamStatus: preparation.status }) });
  return hint === 'project' || hint === 'unsupportedClient' ? NEXT_STEPS.setProjectId
    : hint === 'validation' ? NEXT_STEPS.verifyAccount : NEXT_STEPS.retry;
}

/** Operator text of a preparation failure. */
function preparationMessage(reason: string | undefined): string {
  if (reason === 'project-required')
    return '账号准备未完成：该账号已开通但上游没有为它分配 Google Cloud 项目。请在该模型服务的配置中填写 Google Cloud 项目 ID（projectId，字符串形式如 my-project-123，不是数字项目编号；即 gemini-cli 的 GOOGLE_CLOUD_PROJECT），保存后重新完成准备';
  if (reason === 'UNSUPPORTED_CLIENT')
    return '账号准备未完成：上游拒绝为这个客户端自动开通（UNSUPPORTED_CLIENT），Antigravity 直连目前可能卡在这一步。'
      + '可以在该模型服务的配置中填写自己的 Google Cloud 项目 ID（projectId）后重新完成准备，或改用其他接入方式';
  if (reason === 'validation-required')
    return '账号准备未完成：该账号需要先在浏览器中完成 Google 的账号验证，之后再完成准备';
  return '账号准备未完成：上游服务拒绝或未能完成准备，请查看原因后重试';
}

/** Shown when model discovery succeeds with zero models. */
const DISCOVERY_EMPTY_HINT = '上游模型目录没有返回可用模型：可以直接手动填写模型 ID 继续配置；Codex 订阅还可以在模型服务配置中调整 codexClientVersion（上游按 Codex CLI 版本过滤模型）后重新读取';
function failure(error: unknown): RouteFailure {
  if (error instanceof PersonalSessionMigrationRequiredError)
    return { status: 409, code: 'migration-required' };
  if (error instanceof PersonalSessionAccessError) return { status: 403, code: 'forbidden' };
  if (error instanceof PersonalSessionRevisionConflictError)
    return { status: 409, code: 'revision-conflict', nextStep: NEXT_STEPS.reload };
  if (error instanceof InferenceStoreError) return { status: 503, code: `storage-${error.code}` };
  if (error instanceof TypeError) return { status: 400, code: 'invalid-input' };
  if (error instanceof ProviderError)
    return {
      code: error.code,
      ...(error.code === 'plan-conflict' ? { nextStep: NEXT_STEPS.reload } : error.path ? { nextStep: NEXT_STEPS.editConfig } : {}),
      ...(error.path ? { details: { path: error.path },
        message: error.code === 'invalid-graph'
          ? `配置 ${error.path} 引用的模型配置不存在或类型不对（删除模型配置前请先从这里移除）`
          : `配置 ${error.path} 无效` } : {}),
      status:
        error.code === 'forbidden'
          ? 403
          : error.code === 'plan-conflict' || error.code === 'service-origin-change'
          ? 409
          : error.code === 'driver-unavailable' || error.code === 'driver-contract-mismatch'
          ? 503
          : 400,
    };
  if (error instanceof HttpBodyError) return { status: error.statusCode, code: 'invalid-input' };
  if (error instanceof InferenceManagementError)
    return {
      ...(error.reason ? { reason: error.reason } : {}),
      status: {
        'invalid-input': 400,
        forbidden: 403,
        conflict: 409,
        unavailable: 503,
        unsupported: 422,
      }[error.code],
      code: error.code,
    };
  if (error instanceof InferenceAuthenticationError && error.code === 'client-secret-required')
    return {
      status: 428,
      code: error.code,
      details: { reason: 'client-secret-required' },
      message: '该服务使用机密 OAuth 客户端，登录前需要先为账号设置客户端凭据（client secret）',
      nextStep: NEXT_STEPS.setClientSecret,
    };
  if (error instanceof InferenceAuthenticationError && error.code === 'preparation-failed') {
    const preparation = error.preparation;
    return {
      // Failed dependency: the upstream supplier refused or could not complete account preparation.
      // `code` is fixed for clients; the driver's own code is a separate diagnostic field.
      status: 424,
      code: 'preparation-failed',
      details: {
        ...(preparation?.code ? { preparationCode: preparation.code } : {}),
        ...(preparation?.reason ? { reason: preparation.reason } : {}),
        ...(preparation?.status === undefined ? {} : { upstreamStatus: preparation.status }),
        ...(preparation?.step ? { step: preparation.step } : {}),
      },
      message: preparationMessage(preparation?.reason),
      nextStep: preparationNextStep(preparation),
    };
  }
  if (error instanceof ConnectionTestRateLimitedError)
    return {
      status: 429,
      code: 'rate-limited',
      details: { retryAfterMs: error.retryAfterMs },
      message: '连接测试过于频繁，请稍后重试',
      nextStep: NEXT_STEPS.retry,
    };
  if (error instanceof ProviderDiscoveryError && error.code === 'rate-limited')
    return {
      status: 429,
      code: 'discovery-rate-limited',
      details: {
        upstreamStatus: error.status,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      },
      message: '模型目录请求过于频繁，请稍后重试',
      nextStep: NEXT_STEPS.retry,
    };
  if (error instanceof InferenceAuthenticationError)
    return {
      status: ['conflict', 'identity-change'].includes(error.code)
        ? 409
        : ['not-authorized', 'target-denied'].includes(error.code)
        ? 403
        : 503,
      code: error.code,
      ...(authenticationNextStep(error.code) ? { nextStep: authenticationNextStep(error.code)! } : {}),
    };
  return { status: 503, code: 'unavailable', nextStep: NEXT_STEPS.retry };
}

/** Next step of an authentication failure the operator can act on (#1270). */
function authenticationNextStep(code: string): ConsoleErrorNextStep | undefined {
  if (code === 'reauthorize' || code === 'disconnected' || code === 'not-authorized' || code === 'identity-change') return NEXT_STEPS.login;
  if (code === 'conflict') return NEXT_STEPS.reload;
  if (code === 'outcome-unknown' || code === 'not-submitted' || code === 'rejected') return NEXT_STEPS.retry;
  return undefined;
}

/**
 * The `details` object of a failure body (#1270, `ConsoleErrorDetails`): always present, holding
 * only the safe enum-like fields. They are also kept at the top level for older Consoles.
 */
function failureDetails(result: RouteFailure): ConsoleErrorDetails {
  const details = result.details ?? {};
  return Object.freeze({
    ...(details.step ? { step: details.step } : {}),
    ...(details.reason ? { reason: details.reason } : result.reason ? { reason: result.reason } : {}),
    ...(details.upstreamStatus === undefined ? {} : { upstreamStatus: details.upstreamStatus }),
    ...(details.retryAfterMs === undefined ? {} : { retryAfterMs: details.retryAfterMs }),
    ...(details.path ? { path: details.path } : {}),
    ...(details.preparationCode ? { preparationCode: details.preparationCode } : {}),
  });
}

/** One authenticated management surface for Host and pre-bound personal owners. No raw error or provider response leaves this boundary. */
export function registerInferenceRoutes(options: InferenceRouteOptions): void {
  const base = `${options.base.replace(/\/+$/u, '')}/agent/inference`;
  options.http.route(
    'GET',
    `${base}/owners`,
    (_request, { principal }) => {
      try {
        const data = options.owners({ scope: 'full', ...principalId(principal) });
        return withNoStore(jsonResponse(200, { success: true, data }));
      } catch (error) {
        const result = failure(error);
        return withNoStore(jsonResponse(result.status, {
          success: false,
          code: result.code,
          details: failureDetails(result),
          ...(result.nextStep ? { nextStep: result.nextStep } : {}),
          error: '未关联可管理的模型身份',
        }));
      }
    },
    {
      summary: 'Authenticated model management owners',
      tags: ['agent', 'inference'],
    }
  );
  /** Environment-reference operations are audited (ids and variable names only, never values). */
  const audited = new Set(['/cli/account/add', '/cli/account/rename-env', '/account/test']);
  const record = (
    principal: ConsolePrincipal | undefined,
    path: string,
    outcome: ConsoleAuditEntry['outcome'],
    detail: Readonly<Record<string, unknown>>,
    target?: string
  ) => {
    try {
      options.audit?.({
        actor: auditActor(principal),
        action: `inference${path.replaceAll('/', '.')}`,
        outcome,
        ...(target ? { target: target.slice(0, 512) } : {}),
        detail,
      });
    } catch {
      /* audit never breaks a request */
    }
  };
  const register = (
    method: string,
    path: string,
    operation: (
      input: Readonly<{
        lease: InferenceManagementLease;
        principal: InferenceManagementPrincipal;
        request: Request;
        url: URL;
        signal: AbortSignal;
        consolePrincipal?: ConsolePrincipal;
      }>
    ) => Promise<unknown>
  ) =>
    options.http.route(
      method,
      `${base}${path}`,
      async (request, context) => {
        const { url } = context;
        const controller = new AbortController();
        // Client disconnect before the response finished.
        const abort = () => controller.abort();
        if (request.signal.aborted) abort();
        else request.signal.addEventListener('abort', abort, { once: true });
        let lease: InferenceManagementLease | undefined;
        let operationEntered = false;
        try {
          const principal = {
            ...options.principal({
              scope: 'full',
              ...principalId(context.principal),
              ...(url.searchParams.has('owner')
                ? { requestedOwner: url.searchParams.get('owner')! }
                : {}),
            }),
            environmentReferences: inferenceEnvironmentAuthority(context.principal),
          };
          lease = options.acquire();
          operationEntered = true;
          const data = await operation({
            lease,
            principal,
            request,
            url,
            signal: controller.signal,
            consolePrincipal: context.principal,
          });
          return withNoStore(jsonResponse(200, { success: true, data }));
        } catch (error) {
          const rejected = error instanceof InferenceApplyRejectedError;
          const result = failure(rejected ? error.rejection : error);
          const notCommitted =
            path === '/apply' && (!operationEntered || rejected || error instanceof HttpBodyError);
          if (audited.has(path)) record(context.principal, path, 'denied', { code: result.code, ...(result.reason ? { reason: result.reason } : {}) });
          return withNoStore(jsonResponse(result.status, {
            success: false,
            code: result.code,
            ...(result.details ?? {}),
            ...(result.reason ? { reason: result.reason } : {}),
            details: failureDetails(result),
            ...(result.nextStep ? { nextStep: result.nextStep } : {}),
            ...(notCommitted ? { mutationOutcome: 'not-committed' } : {}),
            error: result.reason ? INFERENCE_ENVIRONMENT_REFUSALS[result.reason] : result.message ?? failureMessage(result.code),
          }));
        } finally {
          request.signal.removeEventListener('abort', abort);
          await lease?.release();
        }
      },
      {
        summary: 'AI Provider runtime management',
        tags: ['agent', 'inference'],
      }
    );
  register('GET', '', ({ lease, principal }) => lease.management.view(principal));
  register('GET', '/targets', ({ lease, principal, url }) => {
    if (!principal.hostAdministrator) throw new InferenceManagementError('forbidden');
    if (!lease.targets) throw new InferenceManagementError('unavailable');
    const limit = url.searchParams.get('limit'),
      offset = url.searchParams.get('offset');
    if (limit === null && offset === null) return lease.targets();
    const page = { limit: Number(limit), offset: Number(offset) };
    if (
      limit === null ||
      offset === null ||
      !/^\d+$/u.test(limit) ||
      !/^\d+$/u.test(offset) ||
      !Number.isSafeInteger(page.limit) ||
      page.limit < 1 ||
      page.limit > 500 ||
      !Number.isSafeInteger(page.offset) ||
      page.offset < 0
    )
      throw new InferenceManagementError('invalid-input');
    return lease.targets(page);
  });
  register('GET', '/export', ({ lease, principal }) => lease.management.export(principal));
  register('GET', '/mutation', ({ lease, principal, url }) =>
    lease.management.mutation(principal, text(url.searchParams.get('mutationId')))
  );
  register('GET', '/sessions', ({ lease, principal, url }) =>
    lease.sessions.list(principal, {
      limit: Number(url.searchParams.get('limit')),
      offset: Number(url.searchParams.get('offset')),
    })
  );
  register('GET', '/session', ({ lease, principal, url }) => {
    let address: unknown;
    try {
      address = JSON.parse(text(url.searchParams.get('address')));
    } catch {
      throw new InferenceManagementError('invalid-input');
    }
    return lease.sessions.read(principal, address);
  });
  register('PUT', '/session', async ({ lease, principal, request }) =>
    lease.sessions.select(principal, await readJsonBody(request))
  );
  register('POST', '/plan', async ({ lease, principal, request }) =>
    lease.management.review(principal, await readJsonBody(request))
  );
  register('POST', '/apply', async ({ lease, principal, request }) =>
    lease.management.apply(principal, await readJsonBody(request))
  );
  register('POST', '/key/prepare', async ({ lease, principal, request }) =>
    lease.management.prepareKey(principal, await readJsonBody(request))
  );
  register('POST', '/client/prepare', async ({ lease, principal, request }) =>
    lease.management.prepareClient(principal, await readJsonBody(request))
  );
  register('POST', '/profile-schema', async ({ lease, principal, request }) =>
    lease.management.profileSchema(principal, await readJsonBody(request))
  );
  register('POST', '/discover', async ({ lease, principal, request, signal }) => {
    const discovered = await lease.management.discover(principal, await readJsonBody(request), signal);
    // An empty catalogue is a successful answer, not an error: the Console shows the hint and lets the
    // operator enter model ids by hand (e.g. when the upstream filters its catalogue by client version).
    return discovered.observations.length === 0
      ? { ...discovered, emptyHint: { code: 'discovery-empty', message: DISCOVERY_EMPTY_HINT } }
      : discovered;
  });
  register('POST', '/login/begin', async ({ lease, principal, request, signal }) => {
    const body = object(await readJsonBody(request)),
      account = await lease.management.account(principal, text(body.accountId));
    return lease.accounts.beginLogin({ account, signal });
  });
  register('POST', '/login/complete', async ({ lease, principal, request, signal }) => {
    const body = object(await readJsonBody(request)),
      account = await lease.management.account(principal, text(body.accountId));
    await lease.accounts.completeCallback({
      account,
      loginId: text(body.loginId),
      callbackUrl: text(body.callbackUrl),
      signal,
    });
    return lease.accounts.status(account);
  });
  register('POST', '/login/cancel', async ({ lease, principal, request }) => {
    const body = object(await readJsonBody(request)),
      account = await lease.management.account(principal, text(body.accountId));
    await lease.accounts.cancelLogin({ account, loginId: text(body.loginId) });
    return lease.accounts.status(account);
  });
  register('POST', '/login/prepare', async ({ lease, principal, request, signal }) => {
    const body = object(await readJsonBody(request)),
      account = await lease.management.account(principal, text(body.accountId));
    await lease.accounts.prepareLogin({
      account,
      expectedRevision: revision(body.expectedRevision),
      signal,
    });
    return lease.accounts.status(account);
  });
  const limitConnectionTest = createConnectionTestLimiter(options.connectionTestRateLimit);
  register('POST', '/probe', async ({ lease, principal, request, signal }) => {
    if (!principal.hostAdministrator) throw new InferenceManagementError('forbidden');
    if (!lease.probe) throw new InferenceManagementError('unavailable');
    const body = object(await readJsonBody(request));
    const profileId = text(body.profileId);
    // Counted per account (a profile without one is its own key), shared with /account/test.
    const accountId = (await lease.management.graph()).profiles[profileId]?.accountId;
    limitConnectionTest(accountId ? `account:${accountId}` : `profile:${profileId}`);
    return lease.probe({ profileId, signal });
  });
  register('POST', '/account/test', async ({ lease, principal, request, signal, consolePrincipal }) => {
    const body = object(await readJsonBody(request)),
      account = await lease.management.account(principal, text(body.accountId));
    if (!lease.probe) throw new InferenceManagementError('unavailable');
    const graph = await lease.management.graph();
    const profiles = Object.values(graph.profiles).filter((profile) => profile.accountId === account.id
      && profile.ownerId === principal.ownerId && graph.services[account.serviceId]?.models[profile.model]?.kinds.includes('language'));
    const chat = graph.purposes.defaults.chat;
    const profile = profiles.find((candidate) => candidate.id === chat) ?? profiles[0];
    if (!profile) throw new InferenceManagementError('unsupported');
    limitConnectionTest(`account:${account.id}`);
    const result = await lease.probe({ profileId: profile.id, signal });
    record(consolePrincipal, '/account/test', result.status === 'ok' ? 'ok' : 'error', { kind: result.kind ?? 'ok', profile: profile.id }, account.id);
    return { result, status: await lease.accounts.status(account) };
  });
  register('POST', '/cli/account/add', async ({ lease, principal, request, consolePrincipal }) => {
    const body = object(await readJsonBody(request));
    const added = await lease.management.addEnvironmentAccount(principal, body);
    record(consolePrincipal, '/cli/account/add', added.result.status === 'committed' ? 'ok' : 'error',
      { service: added.serviceId, createdService: added.createdService, env: String(body.env), status: added.result.status }, added.accountId);
    return added;
  });
  register('POST', '/cli/account/rename-env', async ({ lease, principal, request, consolePrincipal }) => {
    const body = object(await readJsonBody(request));
    const renamed = await lease.management.renameEnvironmentReference(principal, body);
    record(consolePrincipal, '/cli/account/rename-env', renamed.result.status === 'committed' ? 'ok' : 'error',
      { from: String(body.from), to: String(body.to), credential: renamed.credential, status: renamed.result.status }, renamed.accountId);
    return renamed;
  });
  register('POST', '/disconnect', async ({ lease, principal, request }) => {
    const body = object(await readJsonBody(request)),
      account = await lease.management.account(principal, text(body.accountId));
    await lease.accounts.disconnect({
      account,
      expectedRevision: revision(body.expectedRevision),
      authContractVersion: await lease.authenticationContract(account.id),
    });
    return lease.accounts.status(account);
  });
}
