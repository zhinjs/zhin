import {
  dispatchRuntimeConsoleRpc,
  HttpBodyError,
  pickRpcReply,
  readJsonBody,
  type HttpHost,
} from '@zhin.js/host-http';
import { writeJson } from './http-response.js';
import {
  ConsoleRpcRequestScope,
} from './rpc-context.js';
import type { ConsoleRpcComposition } from './rpc-composition.js';

export interface RegisterConsoleRpcRouteOptions extends ConsoleRpcComposition {
  readonly http: HttpHost;
  readonly base: string;
}

export function registerConsoleRpcRoute(options: RegisterConsoleRpcRouteOptions): void {
  const { http, base } = options;

  http.route('POST', `${base}/console/request`, async (
    request, response, _url, authScope, authenticatedPrincipal,
  ) => {
    try {
      const message = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
      const requestScope = new ConsoleRpcRequestScope(options, {
        authScope,
        authenticatedPrincipal,
      });
      let payloads: Awaited<ReturnType<typeof dispatchRuntimeConsoleRpc>>;
      try {
        payloads = await dispatchRuntimeConsoleRpc(message, requestScope.context);
      } finally {
        requestScope.close();
      }
      const match = pickRpcReply(message, payloads);
      if (!match) {
        writeJson(response, 500, { success: false, error: 'No response' });
        return;
      }
      if (match.error) {
        writeJson(response, 400, {
          success: false,
          error: match.error,
          ...(match.data !== undefined ? { data: match.data } : {}),
          requestId: match.requestId,
        });
        return;
      }
      writeJson(response, 200, {
        success: true,
        data: match.data,
        type: match.type,
        requestId: match.requestId,
      });
    } catch (error) {
      if (error instanceof HttpBodyError) {
        writeJson(response, error.statusCode, { success: false, error: error.message });
        return;
      }
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'Console RPC',
    tags: ['console'],
    description: 'Plugin Runtime Console request envelope: `{ type, data?, requestId? }`.',
  });
}
