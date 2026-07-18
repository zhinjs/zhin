import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  type NapCatActionRequest,
  type NapCatActionResponse,
  type NapCatEvent,
} from './protocol.js';
import {
  WS_OPEN,
  type NapCatPendingAction,
  type NapCatWsSocket,
} from './ws-types.js';

const logger = getLogger('napcat');

export function decodeWsPayload(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return String(data ?? '');
}

export function handleNapCatWsMessage(
  data: unknown,
  options: {
    readonly endpointName: string;
    readonly pending: Map<string, NapCatPendingAction>;
    readonly admit: (ev: NapCatEvent) => void;
  },
): void {
  try {
    const raw = decodeWsPayload(data);
    const msg = JSON.parse(raw) as NapCatEvent | NapCatActionResponse;
    if ('echo' in msg && typeof (msg as NapCatActionResponse).echo === 'string') {
      const resp = msg as NapCatActionResponse;
      const pending = options.pending.get(resp.echo!);
      if (pending) {
        options.pending.delete(resp.echo!);
        clearTimeout(pending.timeout);
        if (resp.status === 'ok') pending.resolve(resp.data);
        else {
          pending.reject(new Error(
            `API error [${resp.retcode}]: ${resp.message || resp.wording || 'unknown'}`,
          ));
        }
      }
      return;
    }
    options.admit(msg as NapCatEvent);
  } catch (error) {
    logger.warn(formatCompact({
      op: 'napcat_parse_failed',
      endpoint: options.endpointName,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export function callNapCatWsAction(
  ws: NapCatWsSocket | undefined,
  pending: Map<string, NapCatPendingAction>,
  requestId: { value: number },
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (!ws || ws.readyState !== WS_OPEN) {
    return Promise.reject(new Error('WebSocket is not connected'));
  }
  const echo = `req_${++requestId.value}`;
  const req: NapCatActionRequest = { action, params, echo };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(echo);
      reject(new Error(`API call timeout: ${action}`));
    }, 30_000);
    pending.set(echo, { resolve, reject, timeout });
    ws.send(JSON.stringify(req));
  });
}

export function startNapCatHeartbeat(
  ws: NapCatWsSocket | undefined,
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
  pending: Map<string, NapCatPendingAction>,
  message = 'Connection closed',
): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timeout);
    entry.reject(new Error(message));
  }
  pending.clear();
}
