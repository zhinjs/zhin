import WebSocket from 'ws';
import { buildWsConnectOptions, callOneBot12Action, type OneBot12ActionResponse, type OneBot12WebhookConfig, type OneBot12WsConfig } from './protocol.js';
import { createOneBot12Rpc } from './ws-transport.js';

/** Separate read-only connection: never changes credentials or state of the running Endpoint. */
export async function probeOnebot12Identity(config: OneBot12WsConfig, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  const { url, headers } = buildWsConnectOptions(config);
  const socket = new WebSocket(url, { headers });
  const rpc = createOneBot12Rpc({ endpointId: config.id, signal, socket: () => socket, self: { platform: config.platform, user_id: config.userId }, });
  let rejectOpen: (error: unknown) => void = () => undefined;
  const abort = () => { rejectOpen(signal.reason); rpc.disconnect(); socket.terminate(); };
  signal.addEventListener('abort', abort, { once: true });
  socket.on('message', data => rpc.receive(data, () => undefined));
  socket.on('close', () => { rejectOpen(new Error('Identity connection closed')); rpc.disconnect(); });
  try {
    await new Promise<void>((resolve, reject) => { rejectOpen = reject; socket.once('open', resolve); socket.on('error', reject); });
    signal.throwIfAborted();
    const self = { platform: config.platform, user_id: config.userId };
    return await identifySelectedBot({ selected: self, query: action => rpc.call({ action }), signal });
  } finally {
    signal.removeEventListener('abort', abort); rpc.dispose(); socket.terminate();
  }
}

export async function probeOnebot12HttpIdentity(config: OneBot12WebhookConfig, signal: AbortSignal): Promise<string | undefined> {
  const self = { platform: config.platform, user_id: config.userId };
  return identifySelectedBot({ selected: self, query: action => callOneBot12Action({ url: config.api_url, access_token: config.access_token, signal, self, action }), signal });
}

interface OneBot12IdentityProbe {
  readonly selected: Readonly<{ platform: string; user_id: string }>;
  readonly query: (action: string) => Promise<OneBot12ActionResponse>;
  readonly signal: AbortSignal;
}
async function identifySelectedBot({ selected, query, signal }: OneBot12IdentityProbe): Promise<string | undefined> {
    const status = await query('get_status');
    signal.throwIfAborted();
    if (status.status !== 'ok' || status.retcode !== 0) throw new Error('OneBot12 identity status lookup failed');
    const data = status.data;
    if (!data || typeof data !== 'object' || !('bots' in data) || !Array.isArray(data.bots)) return undefined;
    const match = data.bots.some((bot: unknown) => {
      if (!bot || typeof bot !== 'object' || !('self' in bot) || !bot.self || typeof bot.self !== 'object') return false;
      return 'platform' in bot.self && 'user_id' in bot.self && bot.self.platform === selected.platform && bot.self.user_id === selected.user_id;
    });
    if (!match) return undefined;
    const account = await query('get_self_info');
    signal.throwIfAborted();
    if (account.status !== 'ok' || account.retcode !== 0) throw new Error('OneBot12 account identity lookup failed');
    if (!account.data || typeof account.data !== 'object' || !('user_id' in account.data) || account.data.user_id !== selected.user_id) return undefined;
    return `onebot12:${JSON.stringify([selected.platform, selected.user_id])}`;
}
