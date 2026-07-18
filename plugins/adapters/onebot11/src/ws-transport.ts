import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  type OneBot11ActionRequest,
  type OneBot11ActionResponse,
  type OneBot11Event,
} from './protocol.js';
import {
  WS_OPEN,
  type OneBot11PendingAction,
  type OneBot11WsSocket,
} from './ws-types.js';

const logger = getLogger('onebot11');

export function decodeWsPayload(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return String(data ?? '');
}

export function handleOneBot11WsMessage(
  data: unknown,
  options: {
    readonly endpointName: string;
    readonly pending: Map<string, OneBot11PendingAction>;
    readonly admit: (ev: OneBot11Event) => void;
  },
): void {
  try {
    const raw = decodeWsPayload(data);
    const msg = JSON.parse(raw) as OneBot11Event | OneBot11ActionResponse;
    if ('echo' in msg && typeof (msg as OneBot11ActionResponse).echo === 'string') {
      const resp = msg as OneBot11ActionResponse;
      const pending = options.pending.get(resp.echo!);
      if (pending) {
        options.pending.delete(resp.echo!);
        clearTimeout(pending.timeout);
        if (resp.status === 'ok') pending.resolve(resp.data);
        else pending.reject(new Error(`OneBot11 retcode=${resp.retcode}`));
      }
      return;
    }
    options.admit(msg as OneBot11Event);
  } catch (error) {
    logger.warn(formatCompact({
      op: 'onebot11_parse_failed',
      endpoint: options.endpointName,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export function callOneBot11WsAction(
  ws: OneBot11WsSocket | undefined,
  pending: Map<string, OneBot11PendingAction>,
  requestId: { value: number },
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (!ws || ws.readyState !== WS_OPEN) {
    return Promise.reject(new Error('WebSocket 未连接'));
  }
  const echo = `ob11_${++requestId.value}`;
  const req: OneBot11ActionRequest = { action, params, echo };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(echo);
      reject(new Error(`OneBot11 动作超时: ${action}`));
    }, 30_000);
    pending.set(echo, { resolve, reject, timeout });
    ws.send(JSON.stringify(req));
  });
}

export function startOneBot11Heartbeat(
  ws: OneBot11WsSocket | undefined,
  intervalMs: number,
  existingTimer?: NodeJS.Timeout,
): NodeJS.Timeout {
  if (existingTimer) clearInterval(existingTimer);
  return setInterval(() => {
    try {
      ws?.ping?.();
    } catch {
      /* ignore */
    }
  }, intervalMs);
}

export function rejectAllPending(
  pending: Map<string, OneBot11PendingAction>,
  message = '连接已关闭',
): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timeout);
    entry.reject(new Error(message));
  }
  pending.clear();
}
