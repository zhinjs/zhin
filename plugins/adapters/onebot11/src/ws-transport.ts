import { createPendingRpc, type PendingRpc, type PendingRpcRequest } from 'zhin.js/adapter';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { OneBot11ActionResponse, OneBot11Event } from './protocol.js';
import { WS_OPEN, type OneBot11WsSocket } from './ws-types.js';

const logger = getLogger('onebot11');
export interface OneBot11RpcOptions {
  readonly endpointId: string;
  readonly signal?: AbortSignal;
  /** Reads the lifecycle's selected socket; RPC never opens or reconnects it. */
  readonly socket: () => OneBot11WsSocket | undefined;
}
export interface OneBot11Rpc {
  call(request: PendingRpcRequest): Promise<OneBot11ActionResponse>;
  receive(data: unknown, ingest: (event: OneBot11Event) => void): void;
  disconnect: PendingRpc<OneBot11ActionResponse>['disconnect'];
  dispose(): void;
  readonly pendingCount: number;
}

/** A Client's one request owner serves native SDK actions and framework operations. */
export function createOneBot11Rpc(options: OneBot11RpcOptions): OneBot11Rpc {
  const pending = createPendingRpc<OneBot11ActionResponse>({
    signal: options.signal, requestPrefix: 'ob11_', timeoutMs: 30_000,
    transport: () => { const socket = options.socket(); return socket?.readyState === WS_OPEN ? socket : undefined; },
    serialize: request => JSON.stringify({ action: request.action, params: request.params ?? {}, echo: request.id }),
  });
  return Object.freeze({
    call: pending.call, disconnect: pending.disconnect, dispose: pending.dispose,
    get pendingCount() { return pending.pendingCount; },
    receive(data: unknown, ingest: (event: OneBot11Event) => void) {
      try {
        const message = JSON.parse(decodeWsPayload(data)) as OneBot11Event | OneBot11ActionResponse;
        if ('echo' in message && typeof message.echo === 'string') {
          pending.accept({ id: message.echo, value: message as OneBot11ActionResponse }); return;
        }
        ingest(message as OneBot11Event);
      } catch (error) {
        logger.warn(formatCompact({ op: 'onebot11_parse_failed', endpoint: options.endpointId,
          error: error instanceof Error ? error.message : String(error) }));
      }
    },
  });
}

export function decodeWsPayload(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return String(data ?? '');
}
