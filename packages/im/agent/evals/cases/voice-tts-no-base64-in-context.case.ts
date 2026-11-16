import { defineEvalCase } from '../framework/index.js';

/** ~3 KB of synthesized "audio": long enough to be a real payload, unique enough to search for. */
const AUDIO_BASE64 = Buffer.from(Array.from({ length: 3000 }, (_, index) => (index * 37 + 11) % 256)).toString('base64');
/** Any other tool that returns a data URL: the bytes are replaced before the model sees the result. */
const PREVIEW_BASE64 = Buffer.from(Array.from({ length: 3000 }, (_, index) => (index * 53 + 7) % 256)).toString('base64');

export default defineEvalCase({
  id: 'voice-tts-no-base64-in-context',
  description: 'voice_tts audio is sent once through the reply chain and never reaches the model; a base64 copy in the reply is not a second voice.',
  source: '#1250 batch 29 voice-tts-base64-in-model-context: the mp3 base64 (~25k chars) was returned to the model, '
    + 'which copied it back (5835 output tokens), so the reply carried two voice messages (one broken) and the turn took ~6 minutes.',
  tags: ['multimodal', 'tool-use'],
  inbound: { text: '请用语音说一句你好。' },
  tools: [{
    name: 'voice_tts',
    requiresApproval: 'never',
    description: 'Synthesize a short voice reply; the host sends the returned audio automatically.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    result: { audio: AUDIO_BASE64, format: 'mp3', size: 3000 },
  }, {
    name: 'card_preview',
    requiresApproval: 'never',
    description: 'Render a preview card.',
    parameters: { type: 'object', properties: {} },
    result: { title: '问候卡片', preview: `data:image/png;base64,${PREVIEW_BASE64}` },
  }],
  script: [
    { toolCalls: [{ name: 'voice_tts', args: { text: '你好' } }, { name: 'card_preview', args: {} }] },
    // A model that still copies (a truncated part of) the audio into its reply.
    { segments: [
      { type: 'text', data: { text: '好的' } },
      { type: 'audio', data: { media: { kind: 'base64', value: AUDIO_BASE64.slice(0, 2400) } } },
    ] },
  ],
  expect: {
    toolsCalled: ['voice_tts', 'card_preview'],
    modelInputContains: ['"sent":true', '语音已发送给用户', '问候卡片', '已省略 内嵌 image/png 数据'],
    modelInputNotContains: [AUDIO_BASE64.slice(0, 64), AUDIO_BASE64.slice(-64), PREVIEW_BASE64.slice(0, 64)],
    noRawToolOutput: true,
    outboundContains: ['好的'],
    outboundMessages: 1,
    modelSteps: 2,
  },
  live: {
    checks: (run) => {
      const output = run.terminals.flatMap((event) => event.type === 'turn_end' ? event.output : []);
      const toolAudio = output.filter((element) => element.type === 'audio');
      const copied = output.flatMap((element) => element.type === 'message' ? element.segments : [])
        .filter((segment) => ['audio', 'record', 'voice'].includes(segment.type));
      return [
        { name: 'one synthesized audio element', pass: toolAudio.length === 1 && toolAudio[0]?.base64 === AUDIO_BASE64 },
        { name: 'no copied audio segment', pass: copied.length === 0, detail: `${copied.length} copied audio segment(s)` },
      ];
    },
  },
});
