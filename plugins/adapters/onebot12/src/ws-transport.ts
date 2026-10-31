import { createPendingRpc, type PendingRpc, type PendingRpcRequest } from 'zhin.js/adapter';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { OneBot12ActionResponse, OneBot12Event, OneBot12Self } from './protocol.js';
import { WS_OPEN, type OneBot12WsSocket } from './ws-types.js';

const logger = getLogger('onebot12');
export interface OneBot12RpcOptions {
  readonly endpointId: string;
  readonly signal?: AbortSignal;
  /** Reads the lifecycle's selected socket; RPC never opens or reconnects it. */
  readonly socket: () => OneBot12WsSocket | undefined;
  readonly self: OneBot12Self;
}
export interface OneBot12Rpc {
  call(request: PendingRpcRequest): Promise<OneBot12ActionResponse>;
  receive(data: unknown, ingest: (event: OneBot12Event) => void): void;
  disconnect: PendingRpc<OneBot12ActionResponse>['disconnect'];
  dispose(): void;
  readonly pendingCount: number;
}

/** A Client's one request owner serves native SDK actions and framework operations. */
export function createOneBot12Rpc(options: OneBot12RpcOptions): OneBot12Rpc {
  const pending = createPendingRpc<OneBot12ActionResponse>({
    signal: options.signal, requestPrefix: 'ob12_', timeoutMs: 30_000,
    transport: () => { const socket = options.socket(); return socket?.readyState === WS_OPEN ? socket : undefined; },
    serialize: request => JSON.stringify({ action: request.action, params: request.params ?? {}, echo: request.id, self: options.self }),
  });
  return Object.freeze({
    call: pending.call, disconnect: pending.disconnect, dispose: pending.dispose,
    get pendingCount() { return pending.pendingCount; },
    receive(data: unknown, ingest: (event: OneBot12Event) => void) {
      try {
        const message = JSON.parse(decodeWsPayload(data)) as OneBot12Event | OneBot12ActionResponse;
        if ('echo' in message && typeof message.echo === 'string') {
          pending.accept({ id: message.echo, value: message as OneBot12ActionResponse }); return;
        }
        ingest(message as OneBot12Event);
      } catch (error) {
        logger.warn(formatCompact({ op: 'onebot12_parse_failed', endpoint: options.endpointId,
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
