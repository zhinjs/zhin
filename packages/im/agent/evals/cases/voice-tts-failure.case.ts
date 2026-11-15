import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'voice-tts-failure',
  description: 'A failed speech tool leaves a text reply and no outgoing audio.',
  source: 'A missing edge-tts executable must not become an empty or fabricated voice message; '
    + '#1250 tool-error-result-marked-ok: the returned { error } is a failed call, not `tool_result ok`.',
  tags: ['multimodal', 'tool-use'],
  inbound: { text: '请用语音说一句你好。' },
  tools: [{ name: 'voice_tts', requiresApproval: 'never', result: { error: '语音合成失败: 未找到 edge-tts', hint: '可以改用文字回复' } }],
  script: [
    { toolCalls: [{ name: 'voice_tts', args: { text: '你好' } }] },
    { text: '语音暂时没合成成功，先用文字说：你好。' },
  ],
  expect: {
    toolsCalled: ['voice_tts'],
    streamToolEvents: ['tool_call:voice_tts', 'tool_failed:voice_tts'],
    outboundContains: ['先用文字说：你好', '（语音操作报告失败，是否已部分生效不确定）'],
    // #1250 batch 26: the model sees the whole failed result (the hint too) and is not told nothing changed.
    modelInputContains: ['可以改用文字回复', '是否已部分生效不确定'],
    modelInputNotContains: ['写入/变更没有生效'],
    outboundNotContains: ['[音频:', 'data:audio', '语音已发送', '「voice_tts」'],
    noRawToolOutput: true,
    outboundMessages: 1,
    modelSteps: 2,
  },
});
