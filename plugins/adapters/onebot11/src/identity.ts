import WebSocket from 'ws';
import { buildWsConnectOptions, type OneBot11WsConfig } from './protocol.js';
import { callOneBot11WsAction, handleOneBot11WsMessage, rejectAllPending } from './ws-transport.js';
import type { OneBot11PendingAction } from './ws-types.js';
import { resolveOnebot11SelfId } from './self-id.js';

/** Separate read-only connection: never changes credentials or state of the running Endpoint. */
export async function probeOnebot11Identity(config: OneBot11WsConfig, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  const { url, headers } = buildWsConnectOptions(config);
  const socket = new WebSocket(url, { headers }), pending = new Map<string, OneBot11PendingAction>();
  let rejectOpen: (error: unknown) => void = () => undefined;
  const abort = () => { rejectOpen(signal.reason); rejectAllPending(pending); socket.terminate(); };
  signal.addEventListener('abort', abort, { once: true });
  socket.on('message', data => handleOneBot11WsMessage(data, { endpointId: config.id, pending, ingest: () => undefined }));
  socket.on('close', () => { rejectOpen(new Error('Identity connection closed')); rejectAllPending(pending); });
  try {
    await new Promise<void>((resolve, reject) => { rejectOpen = reject; socket.once('open', resolve); socket.on('error', reject); });
    signal.throwIfAborted();
    const sequence = { value: 0 };
    const response = await callOneBot11WsAction(socket, pending, sequence, 'get_login_info', {});
    signal.throwIfAborted();
    if (response.status !== 'ok' || response.retcode !== 0) throw new Error('OneBot11 identity lookup failed');
    const data: unknown = response.data;
    const id = resolveOnebot11SelfId(data && typeof data === 'object' && 'user_id' in data ? data.user_id : undefined);
    return id === undefined ? undefined : `qq:${id}`;
  } finally {
    signal.removeEventListener('abort', abort); rejectAllPending(pending); socket.terminate();
  }
}
