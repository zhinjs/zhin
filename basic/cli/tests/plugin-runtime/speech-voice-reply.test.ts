import { prepareSpeechHost } from '../../src/plugin-runtime/speech-host-installer.js';
import { extractMediaElementsFromToolCalls } from '../../../../packages/im/agent/src/media/media-tool-bridge.js';
import { publishOutboundElements } from '../../../../packages/im/agent/src/media/media-publisher.js';
import { formatOutboundMessages } from '../../../../plugins/adapters/icqq/src/protocol.js';

afterEach(() => vi.unstubAllGlobals());

it('does not expose explicitly disabled speech tools', async () => {
  const host = await prepareSpeechHost({ stt: { enabled: false }, tts: { enabled: false } });
  expect(host?.tools).toEqual([]);
});

it('produces a voice_tts result that reaches the automatic outbound audio bridge', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }));
  const host = await prepareSpeechHost({ stt: { enabled: false }, tts: { provider: 'openai' } });
  const tool = host!.tools.find((item) => item.name === 'voice_tts')!;
  const result = await tool.execute({ text: '你好' });
  const audio = extractMediaElementsFromToolCalls([{ tool: 'voice_tts', result }]);
  expect(audio)
    .toEqual([{ type: 'audio', url: 'data:audio/mpeg;base64,AQID', base64: 'AQID' }]);
  const segments = await publishOutboundElements(audio, 'icqq');
  expect(formatOutboundMessages(segments)).toEqual([{ type: 'record', file: 'base64://AQID' }]);
  const failure = await tool.execute({ text: '   ' });
  expect(failure).toMatchObject({ error: expect.stringContaining('不能为空') });
  expect(extractMediaElementsFromToolCalls([{ tool: 'voice_tts', result: failure }])).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
