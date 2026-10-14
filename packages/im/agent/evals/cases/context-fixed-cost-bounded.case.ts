import { defineEvalCase } from '../framework/index.js';

const skills = Array.from({ length: 30 }, (_, index) => ({
  name: `skill-${index + 1}`,
  description: `Handles workflow ${index + 1}. ${'Detailed background that only matters once the skill is loaded. '.repeat(6)}`,
  instructions: `SKILL-${index + 1}-INSTRUCTIONS ${'step '.repeat(200)}`,
}));

const tools = Array.from({ length: 30 }, (_, index) => ({
  name: `plugin_tool_${index + 1}`,
  description: `Plugin tool ${index + 1}. ${'Explains every parameter in depth. '.repeat(8)}`,
  deferred: true,
  result: 'ok',
}));

export default defineEvalCase({
  id: 'context-fixed-cost-bounded',
  description: 'With 30 skills and 30 deferred plugin tools, the fixed context stays bounded: no skill bodies, no deferred schemas.',
  source: '#729 M2.1/M2.2/M2.3: fixed cost grew with every installed plugin (≈35k tokens per turn on QQ)',
  tags: ['context'],
  inbound: { text: '你好' },
  skills,
  tools,
  script: [{ text: '你好！' }],
  expect: {
    systemPromptNotContains: ['SKILL-1-INSTRUCTIONS', 'Explains every parameter in depth. Explains every parameter in depth.'],
    contextBudget: {
      maxFixedTokens: 4500,
      maxSegmentTokens: { skill_catalog: 900, tool_index: 900, tool_schemas: 400 },
    },
    modelSteps: 1,
  },
});
