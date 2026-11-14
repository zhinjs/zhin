/**
 * Gateway-owned Console RPC on `POST {base}/console/request` (ADR 0054 §4 / §5): the Console
 * sends `{ type, requestId?, data? }`; `gateway.*` types are answered here with the same reply
 * envelope the instance uses (`{ success, data, type, requestId }` / `{ success: false, code,
 * error, requestId, errors?, missingEnv? }`, see `GatewayRpcHttpErrorReply`), every other
 * type is forwarded to the instance by the HTTP server.
 */
import {
  auditActor,
  jsonResponse,
  unknownRpcLog,
  type ConsolePrincipal,
  type RouteContext,
  type TokenRegistry,
} from '@zhin.js/host-http';
import {
  CONSOLE_DENIAL_REASONS,
  GATEWAY_RPC,
  GATEWAY_RPC_PERMISSIONS,
  type ConsoleDenialReason,
  type GatewayRpcHttpErrorReply,
} from '@zhin.js/console-protocol';
import { isGatewayRpcType, type GatewayRpcDispatcher } from '../packages/rpc.js';
import { gatewayPrincipalAllows } from '../packages/authorization.js';

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

/**
 * Further gateway-owned RPC types (`iam.*`, `onboarding.update`, the global plugin switch), see
 * `GatewayHttpServer.useConsoleRpc`.
 */
export interface GatewayRpcHandler extends GatewayConsoleRpc {
  owns(type: string): boolean;
  /**
   * Narrows {@link owns} by payload: when present and false for the parsed message, the request
   * is forwarded to the instance untouched (e.g. `feature.set-enabled` below the global level).
   */
  claims?(message: Readonly<Record<string, unknown>>): boolean;
  /** RPC types this handler answers, for `GET {base}/console/capabilities`. */
  types?(): readonly string[];
}

/** Why the gateway dispatcher refused `type` (`forbidden`). */
function gatewayDenialReason(type: string, principal: ConsolePrincipal | undefined): ConsoleDenialReason {
  if (!principal) return CONSOLE_DENIAL_REASONS.NOT_AUTHENTICATED;
  if (isGatewayRpcType(type) && !gatewayPrincipalAllows(principal, GATEWAY_RPC_PERMISSIONS[type])) {
    return principal.kind === 'bootstrap' ? CONSOLE_DENIAL_REASONS.SETUP_REQUIRED : CONSOLE_DENIAL_REASONS.INSUFFICIENT_PERMISSION;
  }
  // The permission map admitted it; the service's own rule refused (e.g. bootstrap package limits).
  return CONSOLE_DENIAL_REASONS.HANDLER_DENIED;
}

export function createGatewayConsoleRpc(dispatch: GatewayRpcDispatcher): GatewayConsoleRpc {
  return Object.freeze({
    async handle(message: Readonly<Record<string, unknown>>, context: RouteContext, tokenRegistry: TokenRegistry): Promise<Response> {
      const type = typeof message.type === 'string' ? message.type : '';
      const requestId = message.requestId;
      const principal: ConsolePrincipal | undefined = context.principal;
      const result = await dispatch({ type, data: message.data }, principal);
      const write = !READ_ONLY_TYPES.has(type);
      const unknown = !result.ok && result.error.code === 'unknown_rpc';
      const outcome = result.ok ? 'ok' : result.error.code === 'forbidden' ? 'denied' : 'error';
      // zhinjs/zhin#1250: an unknown `gateway.*` type ran nothing and is not a refusal: not audited.
      if (unknown) unknownRpcLog.note(type);
      else if (write || outcome === 'denied') {
        try {
          tokenRegistry.accessProvider?.audit?.({
            actor: auditActor(principal),
            action: `rpc:${type}`.slice(0, 256),
            outcome,
            ...(outcome === 'denied' ? { detail: { type: type.slice(0, 256), reason: gatewayDenialReason(type, principal) } } : {}),
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
        ...(result.error.errors ? { errors: result.error.errors } : {}),
        ...(result.error.missingEnv ? { missingEnv: result.error.missingEnv } : {}),
      } satisfies GatewayRpcHttpErrorReply, noStore);
    },
  });
}
