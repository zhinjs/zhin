import WebSocket from 'ws';
import { buildWsConnectOptions, readNapCatActionResponse, type NapCatWsConfig } from './protocol.js';
import { createNapCatRpc } from './ws-transport.js';

/** Separate read-only connection: never changes credentials or state of the running Endpoint. */
export async function probeNapcatIdentity(config: NapCatWsConfig, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  const { url, headers } = buildWsConnectOptions(config);
  const socket = new WebSocket(url, { headers });
  const rpc = createNapCatRpc({ endpointId: config.id, signal, socket: () => socket });
  let rejectOpen: (error: unknown) => void = () => undefined;
  const abort = () => { rejectOpen(signal.reason); rpc.disconnect(); socket.terminate(); };
  signal.addEventListener('abort', abort, { once: true });
  socket.on('message', data => rpc.receive(data, () => undefined));
  socket.on('close', () => { rejectOpen(new Error('Identity connection closed')); rpc.disconnect(); });
  try {
    await new Promise<void>((resolve, reject) => { rejectOpen = reject; socket.once('open', resolve); socket.on('error', reject); });
    signal.throwIfAborted();
    const response = await rpc.call({ action: 'get_login_info', signal });
    readNapCatActionResponse(response);
    signal.throwIfAborted();
    const data: unknown = response.data;
    if (!data || typeof data !== 'object' || !('user_id' in data)
      || (typeof data.user_id !== 'string' && typeof data.user_id !== 'number') || !String(data.user_id).trim() || String(data.user_id) === '0') return undefined;
    return `qq:${data.user_id}`;
  } finally {
    signal.removeEventListener('abort', abort); rpc.dispose(); socket.terminate();
  }
}
