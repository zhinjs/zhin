import { createPendingRpc, type PendingRpc, type PendingRpcRequest } from 'zhin.js/adapter';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { NapCatActionResponse, NapCatEvent } from './protocol.js';
import { WS_OPEN, type NapCatWsSocket } from './ws-types.js';

const logger = getLogger('napcat');
export interface NapCatRpcOptions {
  readonly endpointId: string;
  readonly signal?: AbortSignal;
  /** Reads the lifecycle-selected socket; RPC does not open or reconnect it. */
  readonly socket: () => NapCatWsSocket | undefined;
}
export interface NapCatRpc {
  call(request: PendingRpcRequest): Promise<NapCatActionResponse>;
  receive(data: unknown, ingest: (event: NapCatEvent) => void): void;
  disconnect: PendingRpc<NapCatActionResponse>['disconnect'];
  dispose(): void;
  readonly pendingCount: number;
}

/** Native SDK and semantic ports share this Client's correlation and cancellation owner. */
export function createNapCatRpc(options: NapCatRpcOptions): NapCatRpc {
  const pending = createPendingRpc<NapCatActionResponse>({
    signal: options.signal, requestPrefix: 'req_', timeoutMs: 30_000,
    transport: () => { const socket = options.socket(); return socket?.readyState === WS_OPEN ? socket : undefined; },
    serialize: request => JSON.stringify({ action: request.action, params: request.params ?? {}, echo: request.id }),
  });
  return Object.freeze({
    call: pending.call, disconnect: pending.disconnect, dispose: pending.dispose,
    get pendingCount() { return pending.pendingCount; },
    receive(data: unknown, ingest: (event: NapCatEvent) => void) {
      try {
        const message = JSON.parse(decodeWsPayload(data)) as NapCatEvent | NapCatActionResponse;
        if ('echo' in message && typeof message.echo === 'string') {
          pending.accept({ id: message.echo, value: message as NapCatActionResponse }); return;
        }
        ingest(message as NapCatEvent);
      } catch (error) {
        logger.warn(formatCompact({ op: 'napcat_parse_failed', endpoint: options.endpointId,
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
