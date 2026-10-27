import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { computeSignatureHash, resolveWeChatMpConfig } from '../src/protocol.js';
import { handleWeChatMpMessage } from '../src/webhook.js';

const config = resolveWeChatMpConfig({ id: 'fixture', appId: 'fixture', appSecret: 'fixture', token: 'fixture' });
const xml = '<xml><ToUserName>bot</ToUserName><FromUserName>sender</FromUserName><CreateTime>1700000000</CreateTime><MsgType>event</MsgType><Event>subscribe</Event></xml>';

async function invoke(locale: 'en' | 'zh-CN' | undefined, valid = true) {
  const resolveLocale = vi.fn(async () => locale);
  const admit = vi.fn();
  const end = vi.fn();
  const writeHead = vi.fn();
  const url = new URL('http://fixture/wechat');
  const timestamp = String(Math.floor(Date.now() / 1000));
  url.search = new URLSearchParams({ timestamp, nonce: 'nonce', signature: valid ? computeSignatureHash(config.token, { timestamp, nonce: 'nonce' }) : 'invalid' }).toString();
  await handleWeChatMpMessage(Readable.from([Buffer.from(xml)]) as IncomingMessage,
    { end, writeHead } as unknown as ServerResponse, url,
    { config, id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'wechat'), isOpen: true, resolveLocale, admit });
  return { resolveLocale, admit, end, writeHead };
}

it.each([['en', 'Thank you for following!'], ['zh-CN', '感谢关注！'], [undefined, '感谢关注！']] as const)(
  'uses the trusted sender language for a %s subscribe passive reply', async (locale, text) => {
    const result = await invoke(locale);
    expect(result.resolveLocale).toHaveBeenCalledExactlyOnceWith('sender');
    expect(result.end).toHaveBeenCalledWith(expect.stringContaining(text));
    expect(result.end).toHaveBeenCalledWith(expect.stringContaining('<ToUserName><![CDATA[sender]]>'));
    expect(result.admit).not.toHaveBeenCalled();
  },
);
it('rejects invalid signatures before resolving sender preferences', async () => {
  const result = await invoke('en', false);
  expect(result.writeHead).toHaveBeenCalledWith(403, expect.anything());
  expect(result.resolveLocale).not.toHaveBeenCalled();
  expect(result.admit).not.toHaveBeenCalled();
});
