import { NapcatClient } from '../src/client.js';
import { callNapCatHttpAction, resolveNapCatConfig, type NapCatWsConfig } from '../src/protocol.js';

class WsClient extends NapcatClient {
  readonly writer = { readyState: 1, send: (data: string) => {
    const { echo } = JSON.parse(data);
    this.rpc.receive(JSON.stringify({ ...this.response, echo }), () => undefined);
  }, close() {}, on() {} };
  constructor(readonly response: Record<string, unknown>) {
    super({ config: resolveNapCatConfig({ id: 'synthetic', connection: 'ws', url: 'ws://synthetic.invalid' }) as NapCatWsConfig });
    this.transportSocket = this.writer;
  }
}
afterEach(() => vi.unstubAllGlobals());
const cases = [
  [{ status: 'async', retcode: 1 }, 'unknown'],
  [{ retcode: 0 }, 'unknown'],
  [{ status: 'ok' }, 'unknown'],
  [{ status: 'ok', retcode: '0' }, 'unknown'],
  [{ status: 'failed', retcode: 0 }, 'unknown'],
  [{ status: 'ok', retcode: 100 }, 'unknown'],
  [{ status: 'failed', retcode: 1400, message: 'synthetic rejection' }, 'rejected'],
] as const;
it.each(cases)('uses the same verified delivery evidence for HTTP and native WS: %j', async (response, disposition) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response))));
  await expect(callNapCatHttpAction({ http_url: 'https://synthetic.invalid' }, 'set_group_ban'))
    .rejects.toMatchObject({ disposition });
  await expect(new WsClient(response).callApi('set_group_ban')).rejects.toMatchObject({ disposition });
});
it('preserves confirmed success and its native result', async () => {
  const response = { status: 'ok', retcode: 0, data: { message_id: 123 } };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response))));
  await expect(callNapCatHttpAction({ http_url: 'https://synthetic.invalid' }, 'send_msg')).resolves.toEqual(response);
  await expect(new WsClient(response).callApi('send_msg')).resolves.toEqual(response.data);
});
it.each([400, 401, 403, 404, 406, 429])('preserves a protocol HTTP rejection %s', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('synthetic error', { status })));
  await expect(callNapCatHttpAction({ http_url: 'https://synthetic.invalid' }, 'send_msg')).rejects.toMatchObject({ disposition: 'rejected' });
});
