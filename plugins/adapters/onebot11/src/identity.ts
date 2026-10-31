import WebSocket from 'ws';
import { buildWsConnectOptions, type OneBot11WsConfig } from './protocol.js';
import { createOneBot11Rpc } from './ws-transport.js';
import { resolveOnebot11SelfId } from './self-id.js';

/** Separate read-only connection: never changes credentials or state of the running Endpoint. */
export async function probeOnebot11Identity(config: OneBot11WsConfig, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  const { url, headers } = buildWsConnectOptions(config);
  const socket = new WebSocket(url, { headers });
  const rpc = createOneBot11Rpc({ endpointId: config.id, signal, socket: () => socket, });
  let rejectOpen: (error: unknown) => void = () => undefined;
  const abort = () => { rejectOpen(signal.reason); rpc.disconnect(); socket.terminate(); };
  signal.addEventListener('abort', abort, { once: true });
  socket.on('message', data => rpc.receive(data, () => undefined));
  socket.on('close', () => { rejectOpen(new Error('Identity connection closed')); rpc.disconnect(); });
  try {
    await new Promise<void>((resolve, reject) => { rejectOpen = reject; socket.once('open', resolve); socket.on('error', reject); });
    signal.throwIfAborted();

    const response = await rpc.call({ action: 'get_login_info' });
    signal.throwIfAborted();
    if (response.status !== 'ok' || response.retcode !== 0) throw new Error('OneBot11 identity lookup failed');
    const data: unknown = response.data;
    const id = resolveOnebot11SelfId(data && typeof data === 'object' && 'user_id' in data ? data.user_id : undefined);
    return id === undefined ? undefined : `qq:${id}`;
  } finally {
    signal.removeEventListener('abort', abort); rpc.dispose(); socket.terminate();
  }
}
