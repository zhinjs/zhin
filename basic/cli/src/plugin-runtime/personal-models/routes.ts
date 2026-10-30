import type { IncomingMessage } from 'node:http';
import { HttpBodyError, readJsonBody, type HttpHost } from '@zhin.js/host-http';
import { ModelCatalogError } from '@zhin.js/ai/model-catalog';
import { writeJson } from '../console/http-response.js';
import { PersonalModelManagementError, type PersonalModelManagementService } from './service.js';

export interface PersonalModelManagementLease {
  readonly service: PersonalModelManagementService;
  release(): void | Promise<void>;
}
export interface PersonalModelRouteOptions {
  readonly http: HttpHost;
  readonly base: string;
  /** Exact generation lease, acquired once per authenticated HTTP request. */
  readonly acquireService: () => PersonalModelManagementLease | undefined;
}
function failure(error: unknown): Readonly<{ status: number; code: string }> {
  if (error instanceof PersonalModelManagementError) return {
    status: { invalid_input: 400, unauthenticated: 401, forbidden: 403, conflict: 409, unavailable: 503 }[error.code], code: error.code,
  };
  if (error instanceof ModelCatalogError) return {
    status: error.code === 'connection-forbidden' ? 403 : error.code === 'unknown-preset' ? 404 : 400, code: error.code,
  };
  if (error instanceof HttpBodyError) return { status: error.statusCode, code: 'invalid_input' };
  return { status: 503, code: 'unavailable' };
}
function query(url: URL, allowed: readonly string[]): void {
  for (const key of url.searchParams.keys()) {
    if (key !== 'token' && (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)) {
      throw new PersonalModelManagementError('invalid_input');
    }
  }
}

/** Personal APIs have no operator/full bypass: authority comes from an authenticated binding. */
export function registerPersonalModelRoutes(options: PersonalModelRouteOptions): void {
  const base = options.base.replace(/\/+$/u, '');
  const register = (method: string, path: string,
    operation: (service: PersonalModelManagementService, principalId: string, request: IncomingMessage, url: URL) => Promise<unknown>,
  ) => {
    options.http.route(method, `${base}/agent/${path}`, async (request, response, url, _scope, authenticatedPrincipal) => {
      response.setHeader('cache-control', 'no-store');
      if (!authenticatedPrincipal) { writeJson(response, 401, { success: false, code: 'unauthenticated', error: 'Authenticated personal principal required' }); return; }
      let lease: PersonalModelManagementLease | undefined;
      try {
        lease = options.acquireService();
        if (!lease) throw new PersonalModelManagementError('unavailable');
        const data = await operation(lease.service, authenticatedPrincipal.principalId, request, url);
        writeJson(response, 200, { success: true, data });
      } catch (error) {
        const result = failure(error);
        // Never serialize error.message, cause or request values: they may contain submitted API keys.
        writeJson(response, result.status, { success: false, code: result.code, error: 'Personal model request could not be completed' });
      } finally { await lease?.release(); }
    }, { summary: `Personal model management: ${path}`, tags: ['agent', 'personal-models'] });
  };
  register('GET', 'personal-models', async (service, principalId, _request, url) => {
    query(url, []); return service.listModels(principalId);
  });
  register('PUT', 'personal-models', async (service, principalId, request, url) => {
    query(url, []); return service.putModel(principalId, await readJsonBody(request));
  });
  register('GET', 'personal-sessions', async (service, principalId, _request, url) => {
    query(url, ['owner', 'limit', 'offset']);
    const raw = url.searchParams.get('owner');
    if (!raw || !url.searchParams.has('limit') || !url.searchParams.has('offset')) throw new PersonalModelManagementError('invalid_input');
    let owner: unknown;
    try { owner = JSON.parse(raw); } catch { throw new PersonalModelManagementError('invalid_input'); }
    return service.listSessions(principalId, { owner, limit: Number(url.searchParams.get('limit')), offset: Number(url.searchParams.get('offset')) });
  });
  register('GET', 'personal-session', async (service, principalId, _request, url) => {
    query(url, ['address']);
    const raw = url.searchParams.get('address');
    if (!raw) throw new PersonalModelManagementError('invalid_input');
    let address: unknown;
    try { address = JSON.parse(raw); } catch { throw new PersonalModelManagementError('invalid_input'); }
    return service.readSession(principalId, address);
  });
  register('PUT', 'personal-session', async (service, principalId, request, url) => {
    query(url, []); return service.selectSession(principalId, await readJsonBody(request));
  });
}
