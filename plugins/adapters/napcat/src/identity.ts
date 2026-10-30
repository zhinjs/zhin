import WebSocket from 'ws';
import { buildWsConnectOptions, type NapCatWsConfig } from './protocol.js';
import { callNapCatWsAction, handleNapCatWsMessage, rejectAllPending } from './ws-transport.js';
import type { NapCatPendingAction } from './ws-types.js';

/** Separate read-only connection: never changes credentials or state of the running Endpoint. */
export async function probeNapcatIdentity(config: NapCatWsConfig, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  const { url, headers } = buildWsConnectOptions(config);
  const socket = new WebSocket(url, { headers }), pending = new Map<string, NapCatPendingAction>();
  let rejectOpen: (error: unknown) => void = () => undefined;
  const abort = () => { rejectOpen(signal.reason); rejectAllPending(pending); socket.terminate(); };
  signal.addEventListener('abort', abort, { once: true });
  socket.on('message', data => handleNapCatWsMessage(data, { endpointId: config.id, pending, admit: () => undefined }));
  socket.on('close', () => { rejectOpen(new Error('Identity connection closed')); rejectAllPending(pending); });
  try {
    await new Promise<void>((resolve, reject) => { rejectOpen = reject; socket.once('open', resolve); socket.on('error', reject); });
    signal.throwIfAborted();
    const sequence = { value: 0 };
    const response = await callNapCatWsAction(socket, pending, sequence, 'get_login_info', {});
    signal.throwIfAborted();
    const data: unknown = response;
    if (!data || typeof data !== 'object' || !('user_id' in data)
      || (typeof data.user_id !== 'string' && typeof data.user_id !== 'number') || !String(data.user_id).trim() || String(data.user_id) === '0') return undefined;
    return `qq:${data.user_id}`;
  } finally {
    signal.removeEventListener('abort', abort); rejectAllPending(pending); socket.terminate();
  }
}
