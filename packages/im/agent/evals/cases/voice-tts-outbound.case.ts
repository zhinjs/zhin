import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'voice-tts-outbound',
  description: 'A requested voice reply carries the synthesized audio through the structured reply path exactly once.',
  source: 'Speech tool success must produce an audio message, not merely a claim that it was sent.',
  tags: ['multimodal', 'tool-use'],
  inbound: { text: '请用语音说一句你好。' },
  tools: [{
    name: 'voice_tts',
    requiresApproval: 'never',
    description: 'Synthesize a short voice reply; the host sends the returned audio automatically.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    result: { audio: 'AQID', format: 'mp3', size: 3 },
  }],
  script: [
    { toolCalls: [{ name: 'voice_tts', args: { text: '你好' } }] },
    { segments: [] },
  ],
  expect: {
    toolsCalled: ['voice_tts'],
    noRawToolOutput: true,
    outboundMessages: 1,
    modelSteps: 2,
  },
  live: {
    checks: (run) => {
      const audio = run.terminals.flatMap((event) => event.type === 'turn_end' ? event.output : [])
        .filter((element) => element.type === 'audio');
      return [{ name: 'one synthesized audio element', pass: audio.length === 1 && audio[0]?.base64 === 'AQID' }];
    },
  },
});
