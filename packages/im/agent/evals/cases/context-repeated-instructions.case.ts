import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'context-repeated-instructions',
  description: 'Loaded skills and runtime workspace rules appear once across turns, with raw history retained.',
  source: '#954: repeated envelopes grew input each turn and undermined prefix reuse',
  tags: ['context', 'tool-use'],
  skills: [{ name: 'report', description: 'Report instructions', instructions: 'UNIQUE-REPORT-BODY: verify facts and record sources.' }],
  inbound: [{ text: '第一轮' }, { text: '第二轮' }, { text: '第三轮' }],
  script: [
    { toolCalls: [{ name: 'load_skill', args: { name: 'report' } }] },
    { text: '已加载' }, { text: '继续' }, { text: '完成' },
  ],
  expect: {
    modelSteps: 4,
    maxInputOccurrences: { 'UNIQUE-REPORT-BODY': 1, '[Agents instructions]': 1 },
    requestInputContains: { 2: ['UNIQUE-REPORT-BODY'], 3: ['UNIQUE-REPORT-BODY'], 4: ['UNIQUE-REPORT-BODY'] },
    systemPromptNotContains: ['UNIQUE-REPORT-BODY'],
  },
});
