import { expect, it, vi } from 'vitest';
import { createHttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { WeChatMpEndpoint } from '../src/endpoint.js';
import { computeSignatureHash, resolveWeChatMpConfig } from '../src/protocol.js';

async function fixture() {
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const receive = vi.fn(async (_message: unknown) => undefined), resolveLocale = vi.fn(async () => 'en' as const);
  const config = resolveWeChatMpConfig({ id: 'synthetic', appId: 'synthetic-app', appSecret: 'synthetic-secret', token: 'synthetic-callback', replyMode: 'customer_service' });
  const harness = await createEndpointHarness(() => new WeChatMpEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'wechat-mp'), config, http,
    fetch: vi.fn(async () => ({ data: { access_token: 'synthetic-token', expires_in: 7200 } })) }), { gateway: { ...createTestEventGateway({ receive }), resolveLocale } });
  await harness.start(); harness.open(); const { port } = await http.listen();
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'synthetic-nonce';
  const url = new URL(`http://127.0.0.1:${port}${config.path}`);
  url.search = new URLSearchParams({ timestamp, nonce, signature: computeSignatureHash(config.token, { timestamp, nonce }) }).toString();
  return { receive, resolveLocale, post: (xml: string) => fetch(url, { method: 'POST', body: xml }), close: async () => { await harness.stop(); await http.close(); } };
}
it('preserves the entire authenticated XML as canonical native event including unrecognized fields and attributes', async () => {
  const f = await fixture(); const xml = '<xml extension="unrecognized"><ToUserName>bot</ToUserName><FromUserName>actual-user</FromUserName><CreateTime>1</CreateTime><MsgType>text</MsgType><Content><![CDATA[hello]]></Content><MsgId>native-message</MsgId><Future flag="keep">value</Future></xml>';
  try {
    expect((await f.post(xml)).status).toBe(200); await vi.waitFor(() => expect(f.receive).toHaveBeenCalledTimes(1));
    expect(f.receive.mock.calls[0]![0]).toMatchObject({ content: 'hello', sender: { id: 'actual-user' }, event: xml });
  } finally { await f.close(); }
});
it('resolves subscribe reply language through the bound endpoint specification rather than adding a framework method to the native client', async () => {
  const f = await fixture();
  try {
    const response = await f.post('<xml><ToUserName>bot</ToUserName><FromUserName>actual-user</FromUserName><CreateTime>1</CreateTime><MsgType>event</MsgType><Event>subscribe</Event></xml>');
    expect(await response.text()).toContain('Thank you for following!'); expect(f.resolveLocale).toHaveBeenCalledWith(expect.anything(), 'actual-user');
  } finally { await f.close(); }
});
