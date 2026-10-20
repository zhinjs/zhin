import { clearTimeout, setTimeout } from 'node:timers';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type {
  OneBot12ActionRequest,
  OneBot12ActionResponse,
  OneBot12Event,
} from './protocol.js';
import {
  type OneBot12PendingAction,
  type OneBot12WsSocket,
  WS_OPEN,
} from './ws-types.js';

const logger = getLogger('onebot12');

export interface OneBot12WsMessageOptions {
  readonly endpointId: string;
  readonly pending: Map<string, OneBot12PendingAction>;
  readonly ingest: (event: OneBot12Event) => void;
}

export function handleOneBot12WsMessage(
  data: unknown,
  options: OneBot12WsMessageOptions,
): void {
  try {
    const message = JSON.parse(decodeOneBot12WsPayload(data)) as
      | OneBot12Event
      | OneBot12ActionResponse;
    if ('echo' in message && typeof message.echo === 'string') {
      const response = message as OneBot12ActionResponse;
      const pending = options.pending.get(response.echo!);
      if (pending) {
        options.pending.delete(response.echo!);
        clearTimeout(pending.timeout);
        pending.resolve(response);
      }
      return;
    }
    options.ingest(message as OneBot12Event);
  } catch (error) {
    logger.warn(formatCompact({
      op: 'onebot12_parse_failed',
      endpoint: options.endpointId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export function callOneBot12WsAction(
  ws: OneBot12WsSocket | undefined,
  pending: Map<string, OneBot12PendingAction>,
  requestId: { value: number },
  action: string,
  params: Record<string, unknown>,
): Promise<OneBot12ActionResponse> {
  if (!ws || ws.readyState !== WS_OPEN) {
    return Promise.reject(new Error('WebSocket 未连接'));
  }
  const echo = `ob12_${++requestId.value}`;
  const request: OneBot12ActionRequest = { action, params, echo };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(echo);
      reject(new Error(`OneBot12 动作超时: ${action}`));
    }, 30_000);
    pending.set(echo, { resolve, reject, timeout });
    ws.send(JSON.stringify(request));
  });
}

export function rejectAllPending(
  pending: Map<string, OneBot12PendingAction>,
  message = '连接已关闭',
): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timeout);
    entry.reject(new Error(message));
  }
  pending.clear();
}

function decodeOneBot12WsPayload(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return String(data ?? '');
}
