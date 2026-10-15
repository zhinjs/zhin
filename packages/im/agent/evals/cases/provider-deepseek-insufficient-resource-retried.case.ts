import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-deepseek-insufficient-resource-retried',
  description: 'A DeepSeek finishReason insufficient_system_resource is retried like a 5xx, not reported as a malformed tool call.',
  source: '#724 provider audit S9: DeepSeek insufficient_system_resource → retry',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  script: [
    { model: 'scripted-model', fault: { kind: 'finish', finishReason: 'error', raw: 'insufficient_system_resource' } },
    { model: 'scripted-model', text: '早上好，今天也要元气满满！' },
  ],
  expect: {
    modelIds: ['scripted-model', 'scripted-model'],
    outboundContains: ['早上好，今天也要元气满满'],
    outboundNotContains: ['insufficient_system_resource', '无法解析', '模型调用失败'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
