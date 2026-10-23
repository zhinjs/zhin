import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'voice-tts-failure',
  description: 'A failed speech tool leaves a text reply and no outgoing audio.',
  source: 'A missing edge-tts executable must not become an empty or fabricated voice message.',
  tags: ['multimodal', 'tool-use'],
  inbound: { text: '请用语音说一句你好。' },
  tools: [{ name: 'voice_tts', requiresApproval: 'never', result: { error: '语音合成失败: 未找到 edge-tts' } }],
  script: [
    { toolCalls: [{ name: 'voice_tts', args: { text: '你好' } }] },
    { text: '语音暂时没合成成功，先用文字说：你好。' },
  ],
  expect: {
    toolsCalled: ['voice_tts'],
    outboundContains: ['先用文字说：你好'],
    outboundNotContains: ['[音频:', 'data:audio', '语音已发送'],
    noRawToolOutput: true,
    outboundMessages: 1,
    modelSteps: 2,
  },
});
