/**
 * Gateway-owned Console RPC on `POST {base}/console/request` (ADR 0054 §4 / §5): the Console
 * sends `{ type, requestId?, data? }`; `gateway.*` types are answered here with the same reply
 * envelope the instance uses (`{ success, data, type, requestId }` / `{ success: false, code,
 * error, requestId }`), every other type is forwarded to the instance by the HTTP server.
 */
import {
  auditActor,
  jsonResponse,
  type ConsolePrincipal,
  type RouteContext,
  type TokenRegistry,
} from '@zhin.js/host-http';
import { GATEWAY_RPC } from '@zhin.js/console-protocol';
import type { GatewayRpcDispatcher } from '../packages/rpc.js';

/** RPC types with this prefix belong to the gateway (unknown ones are refused as unmapped). */
export const GATEWAY_RPC_PREFIX = 'gateway.';

const READ_ONLY_TYPES: ReadonlySet<string> = new Set([
  GATEWAY_RPC.LIST,
  GATEWAY_RPC.PLAN,
  GATEWAY_RPC.STATUS,
  GATEWAY_RPC.LOGS,
]);

export interface GatewayConsoleRpc {
  handle(message: Readonly<Record<string, unknown>>, context: RouteContext, tokenRegistry: TokenRegistry): Promise<Response>;
}

/** Further gateway-owned RPC types (`iam.*`, `onboarding.update`), see `GatewayHttpServer.useConsoleRpc`. */
export interface GatewayRpcHandler extends GatewayConsoleRpc {
  owns(type: string): boolean;
}

export function createGatewayConsoleRpc(dispatch: GatewayRpcDispatcher): GatewayConsoleRpc {
  return Object.freeze({
    async handle(message: Readonly<Record<string, unknown>>, context: RouteContext, tokenRegistry: TokenRegistry): Promise<Response> {
      const type = typeof message.type === 'string' ? message.type : '';
      const requestId = message.requestId;
      const principal: ConsolePrincipal | undefined = context.principal;
      const result = await dispatch({ type, data: message.data }, principal);
      const write = !READ_ONLY_TYPES.has(type);
      const outcome = result.ok ? 'ok' : result.error.code === 'forbidden' ? 'denied' : 'error';
      if (write || outcome === 'denied') {
        try {
          tokenRegistry.accessProvider?.audit?.({
            actor: auditActor(principal),
            action: `rpc:${type}`.slice(0, 256),
            outcome,
            ...(context.remoteAddress ? { ip: context.remoteAddress } : {}),
          });
        } catch { /* audit never breaks a request */ }
      }
      const noStore = { 'cache-control': 'no-store' };
      if (result.ok) return jsonResponse(200, { success: true, data: result.data, type, requestId }, noStore);
      return jsonResponse(result.error.status, {
        success: false,
        code: result.error.code,
        error: result.error.message,
        requestId,
      }, noStore);
    },
  });
}
