import { defineEvalCase } from '../framework/index.js';

const DEADLINE_EXCEEDED = {
  error: { code: 504, message: 'Deadline expired before operation could complete.', status: 'DEADLINE_EXCEEDED' },
};

export default defineEvalCase({
  id: 'provider-gemini-deadline-exceeded-polite',
  description: 'Gemini 504 DEADLINE_EXCEEDED is treated as a timeout: retried, then reported as a timeout (not an outage) in plain words.',
  source: '#724 provider resilience, Gemini primary (#770): 504 DEADLINE_EXCEEDED → timeout',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  agentConfig: { providerResilience: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  script: [
    { fault: { kind: 'error', message: DEADLINE_EXCEEDED.error.message, status: 504, body: DEADLINE_EXCEEDED } },
    { fault: { kind: 'error', message: DEADLINE_EXCEEDED.error.message, status: 504, body: DEADLINE_EXCEEDED } },
  ],
  expect: {
    outboundContains: ['模型服务响应超时', '稍后再试'],
    outboundNotContains: ['Deadline expired', '暂时不可用', '请检查 API 密钥'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
