/** Maps local socket requests onto the gateway RPC with principal `'local'` (ADR 0054 §6). */
import { GATEWAY_RPC } from '@zhin.js/console-protocol';
import type { GatewayRpcDispatcher } from '../packages/rpc.js';
import type { GatewayPackageService } from '../packages/service.js';
import type { LocalRequestHandler, LocalRequestResult } from './local-socket.js';
import { LOCAL_GATEWAY_RPC, type LocalGatewayInfoResult } from './protocol.js';

export interface LocalRpcHandlerOptions {
  readonly dispatch: GatewayRpcDispatcher;
  /** Progress of package transactions is streamed to the requesting connection. */
  readonly packages?: GatewayPackageService;
  readonly info: () => LocalGatewayInfoResult;
  /** Called after the `gateway.shutdown` answer was queued. */
  readonly shutdown: () => void;
  /** Socket-only `gateway.console.*` (Console setup and user rescue); absent without Console. */
  readonly console?: {
    owns(type: string): boolean;
    handle(type: string, data: unknown): Promise<LocalRequestResult>;
  };
}

const STREAMED: ReadonlySet<string> = new Set([GATEWAY_RPC.INSTALL, GATEWAY_RPC.UNINSTALL, GATEWAY_RPC.UPDATE]);

export function createLocalRpcHandler(options: LocalRpcHandlerOptions): LocalRequestHandler {
  return async (request, emit) => {
    if (request.type === LOCAL_GATEWAY_RPC.INFO) return { ok: true, data: options.info() };
    if (request.type === LOCAL_GATEWAY_RPC.SHUTDOWN) {
      setImmediate(options.shutdown);
      return { ok: true, data: { stopping: true } };
    }
    if (options.console?.owns(request.type)) return options.console.handle(request.type, request.data);
    // One transaction at a time: the first `start` seen after subscribing is this request's.
    let transaction: string | undefined;
    const unsubscribe = STREAMED.has(request.type)
      ? options.packages?.subscribe((event) => {
        if (transaction === undefined && event.type === 'start') transaction = event.id;
        if (event.id === transaction) emit(event);
      })
      : undefined;
    try {
      return await options.dispatch({ type: request.type, data: request.data }, 'local');
    } finally {
      unsubscribe?.();
    }
  };
}
