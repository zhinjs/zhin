import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extractBearerToken, HttpBodyError, readJsonBody, type HttpHost } from '@zhin.js/host-http';
import { DataMigrationError, normalizeDeliveryTarget, type PluginId, type SnapshotReader } from '@zhin.js/plugin-runtime';
import { DataMigrationController, DataMigrationPlanStore } from '../data-migration/index.js';
import { writeJson } from './http-response.js';

export interface DataMigrationRouteOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly projectRoot: string;
  readonly snapshots?: SnapshotReader;
}

interface MigrationHttpOperation {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly scope: string;
  readonly run: (service: DataMigrationController, signal: AbortSignal) => Promise<unknown>;
}

/** Administrator-only entry: record selection never supplies authority or a filesystem path. */
export function registerDataMigrationRoutes(options: DataMigrationRouteOptions): void {
  const { http, base, snapshots } = options;
  const controller = snapshots ? new DataMigrationController({ snapshots,
    store: new DataMigrationPlanStore({ directory: path.join(options.projectRoot, 'data', 'migration-plans') }),
  }) : undefined;
  const serve = async ({ request, response, scope, run }: MigrationHttpOperation) => {
    response.setHeader('cache-control', 'no-store');
    const tokenScope = http.tokenRegistry.resolve(extractBearerToken(request.headers.authorization, null));
    if (scope !== 'full' || tokenScope !== 'full') {
      writeJson(response, tokenScope === 'demo' ? 403 : 401, { success: false, code: 'forbidden', error: '需要管理员凭据' });
      return;
    }
    if (!controller) {
      writeJson(response, 503, { success: false, code: 'unavailable', error: '迁移运行时尚未就绪' }); return;
    }
    const cancellation = new AbortController();
    const disconnect = () => { if (!response.writableEnded) cancellation.abort(new Error('Migration request disconnected')); };
    response.on('close', disconnect);
    try {
      const data = await run(controller, cancellation.signal);
      writeJson(response, 200, { success: true, data });
    } catch (error) {
      const failure = error instanceof DataMigrationError ? error
        : error instanceof HttpBodyError ? new DataMigrationError('invalid_input', '请求体无效或过大') : undefined;
      const status = failure ? statusFor(failure.code) : 500;
      writeJson(response, status, { success: false, code: failure?.code ?? 'failed', error: failure?.message ?? '迁移操作失败' });
    } finally { response.off('close', disconnect); }
  };
  http.route('GET', `${base}/data-migrations`, (request, response, url, scope) => serve({ request, response, scope, run: async (service, signal) => {
    const planId = url.searchParams.get('planId');
    const owner = url.searchParams.get('owner');
    if ([...url.searchParams.keys()].some(key => !['planId', 'owner'].includes(key)) || planId && owner
      || url.searchParams.getAll('planId').length > 1 || url.searchParams.getAll('owner').length > 1) invalid();
    if (planId !== null) return service.read({ planId: nonempty(planId), signal });
    if (owner !== null) return service.preview({ owner: nonempty(owner) as PluginId, signal });
    return service.listProviders({ signal });
  } }), { summary: 'Preview historical data or read a migration plan', tags: ['console', 'data-migration'] });
  http.route('POST', `${base}/data-migrations/commands`, (request, response, _url, scope) => serve({ request, response, scope, run: async (service, signal) => {
    const body = await readJsonBody<unknown>(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalid();
    const input = body as Record<string, unknown>;
    if (input.action === 'prepare') {
      exactKeys(input, ['action', 'owner', 'candidateId', 'expectedDigest', 'target']);
      let target;
      try { target = normalizeDeliveryTarget(input.target); }
      catch { throw new DataMigrationError('invalid_input', '请选择完整的账号和会话'); }
      return service.prepare({ owner: nonempty(input.owner) as PluginId, candidateId: nonempty(input.candidateId),
        expectedDigest: nonempty(input.expectedDigest), target, signal });
    }
    exactKeys(input, ['action', 'planId']);
    const operation = { planId: nonempty(input.planId), signal };
    switch (input.action) {
      case 'apply': return service.apply(operation);
      case 'reconcile': return service.reconcile(operation);
      case 'resume': return service.resume(operation);
      case 'restore': return service.restore(operation);
      default: return invalid();
    }
  } }), { summary: 'Explicitly prepare, apply, inspect, resume or restore selected historical data', tags: ['console', 'data-migration'] });
}
function nonempty(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}
function exactKeys(input: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(input).length !== keys.length || !keys.every(key => Object.hasOwn(input, key))) invalid();
}
function invalid(): never { throw new DataMigrationError('invalid_input', '迁移参数无效'); }
function statusFor(code: DataMigrationError['code']): number {
  switch (code) {
    case 'invalid_input': case 'unsupported': return 400;
    case 'conflict': return 409;
    case 'not_found': return 404;
    case 'commit_unknown': return 504;
    case 'unavailable': return 503;
  }
}
