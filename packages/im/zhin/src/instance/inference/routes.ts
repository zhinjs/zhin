import {
  HttpBodyError,
  isUserPrincipal,
  jsonResponse,
  readJsonBody,
  type AuthScope,
  type ConsolePrincipal,
  type HttpHost,
} from '@zhin.js/host-http';
import { withNoStore } from '../console/no-store.js';

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
  InferenceManagementError,
  InferenceApplyRejectedError,
  type InferenceManagementPrincipal,
  type InferenceManagementService,
} from '@zhin.js/agent/runtime';
import type { InferenceTargetsReader } from '@zhin.js/agent/runtime';
import type { InferenceSessionManagement } from '@zhin.js/agent/runtime';

export interface InferenceManagementLease {
  readonly management: InferenceManagementService;
  readonly accounts: HostAccountRuntime;
  readonly sessions: InferenceSessionManagement;
  readonly targets?: InferenceTargetsReader;
  readonly authenticationContract: (accountId: string) => Promise<string>;
  release(): void | Promise<void>;
}
export interface InferenceRouteOptions {
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
interface RouteFailure {
  readonly status: number;
  readonly code: string;
  /** Safe, enum-like diagnostics only (driver step, upstream HTTP status and reason code). */
  readonly details?: Readonly<{ preparationCode?: string; reason?: string; upstreamStatus?: number; step?: string; retryAfterMs?: number }>;
  /** Operator-facing text replacing the generic one when the failure is actionable. */
  readonly message?: string;
}
function failure(error: unknown): RouteFailure {
  if (error instanceof PersonalSessionMigrationRequiredError)
    return { status: 409, code: 'migration-required' };
  if (error instanceof PersonalSessionAccessError) return { status: 403, code: 'forbidden' };
  if (error instanceof PersonalSessionRevisionConflictError)
    return { status: 409, code: 'revision-conflict' };
  if (error instanceof InferenceStoreError) return { status: 503, code: `storage-${error.code}` };
  if (error instanceof TypeError) return { status: 400, code: 'invalid-input' };
  if (error instanceof ProviderError)
    return {
      code: error.code,
      status:
        error.code === 'forbidden'
          ? 403
          : error.code === 'plan-conflict'
          ? 409
          : error.code === 'driver-unavailable' || error.code === 'driver-contract-mismatch'
          ? 503
          : 400,
    };
  if (error instanceof HttpBodyError) return { status: error.statusCode, code: 'invalid-input' };
  if (error instanceof InferenceManagementError)
    return {
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
      message: '账号准备未完成：上游服务拒绝或未能完成准备，请查看原因后重试',
    };
  }
  if (error instanceof ProviderDiscoveryError && error.code === 'rate-limited')
    return {
      status: 429,
      code: 'discovery-rate-limited',
      details: {
        upstreamStatus: error.status,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      },
      message: '模型目录请求过于频繁，请稍后重试',
    };
  if (error instanceof InferenceAuthenticationError)
    return {
      status: ['conflict', 'identity-change'].includes(error.code)
        ? 409
        : ['not-authorized', 'target-denied'].includes(error.code)
        ? 403
        : 503,
      code: error.code,
    };
  return { status: 503, code: 'unavailable' };
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
          error: '未关联可管理的模型身份',
        }));
      }
    },
    {
      summary: 'Authenticated model management owners',
      tags: ['agent', 'inference'],
    }
  );
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
          const principal = options.principal({
            scope: 'full',
            ...principalId(context.principal),
            ...(url.searchParams.has('owner')
              ? { requestedOwner: url.searchParams.get('owner')! }
              : {}),
          });
          lease = options.acquire();
          operationEntered = true;
          const data = await operation({
            lease,
            principal,
            request,
            url,
            signal: controller.signal,
          });
          return withNoStore(jsonResponse(200, { success: true, data }));
        } catch (error) {
          const rejected = error instanceof InferenceApplyRejectedError;
          const result = failure(rejected ? error.rejection : error);
          const notCommitted =
            path === '/apply' && (!operationEntered || rejected || error instanceof HttpBodyError);
          return withNoStore(jsonResponse(result.status, {
            success: false,
            code: result.code,
            ...(result.details ?? {}),
            ...(notCommitted ? { mutationOutcome: 'not-committed' } : {}),
            error: result.message ?? '模型服务操作未完成',
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
  register('POST', '/discover', async ({ lease, principal, request, signal }) =>
    lease.management.discover(principal, await readJsonBody(request), signal)
  );
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
