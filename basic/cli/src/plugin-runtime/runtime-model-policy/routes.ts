import { HttpBodyError, readJsonBody, type HttpHost } from '@zhin.js/host-http';
import { RuntimePolicyStateError } from '@zhin.js/agent/model-policy';
import { writeJson } from '../console/http-response.js';
import type { RuntimePolicyTargetsReader, RuntimePolicyTargetPage } from './targets.js';
import { RuntimePolicyManagementError, type RuntimePolicyManagementService } from './service.js';

export interface RuntimePolicyManagementLease { readonly service: RuntimePolicyManagementService; readonly readTargets?: RuntimePolicyTargetsReader; release(): void | Promise<void> }
export function registerRuntimeModelPolicyRoutes(options: Readonly<{
  http: HttpHost; base: string; acquireService: () => RuntimePolicyManagementLease | undefined;
}>): void {
  for (const method of ['GET', 'PUT']) options.http.route(method, `${options.base.replace(/\/+$/u, '')}/agent/model-policy`, async (request, response, url, authScope) => {
    response.setHeader('cache-control', 'no-store');
    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (authScope !== 'full' || options.http.tokenRegistry.resolve(bearer) !== 'full') {
      writeJson(response, 403, { success: false, code: 'forbidden', error: 'Full operator token required' });
      return;
    }
    let lease: RuntimePolicyManagementLease | undefined;
    try {
      if ([...url.searchParams.keys()].some(key => !['token', 'targetsLimit', 'targetsOffset'].includes(key))) throw new RuntimePolicyManagementError('invalid_input');
      const limit = url.searchParams.get('targetsLimit'), offset = url.searchParams.get('targetsOffset');
      let page: RuntimePolicyTargetPage | undefined;
      if (limit !== null || offset !== null) {
        if (method !== 'GET' || limit === null || offset === null || !/^\d+$/u.test(limit) || !/^\d+$/u.test(offset)
          || !Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 500
          || !Number.isSafeInteger(Number(offset)) || Number(offset) < 0) throw new RuntimePolicyManagementError('invalid_input');
        page = { limit: Number(limit), offset: Number(offset) };
      }
      lease = options.acquireService();
      if (!lease) throw new RuntimePolicyStateError('unavailable');
      const data = method === 'GET' ? await lease.service.read() : await lease.service.replace(await readJsonBody(request));
      const targets = await lease.readTargets?.(page);
      writeJson(response, 200, { success: true, data: { ...data, ...(targets ? { targets } : {}) } });
    } catch (error) {
      const code = error instanceof RuntimePolicyManagementError ? error.code
        : error instanceof HttpBodyError ? 'invalid_input'
          : error instanceof RuntimePolicyStateError && error.code === 'commit_unknown' ? 'commit_unknown' : 'unavailable';
      writeJson(response, code === 'conflict' ? 409 : code === 'invalid_input' ? 400 : 503,
        { success: false, code, error: 'Runtime model policy request could not be completed' });
    } finally {
      try { await lease?.release(); } catch { /* Cleanup never changes an acknowledged write or leaks a private cause. */ }
    }
  }, { summary: 'Deployment model reference overrides', tags: ['agent', 'model-policy'] });
}
