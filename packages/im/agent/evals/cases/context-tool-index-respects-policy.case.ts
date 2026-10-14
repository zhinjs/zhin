import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'context-tool-index-respects-policy',
  description: 'The deferred tool index never advertises a tool the turn cannot use (no bash for a group member).',
  source: '#729: listing deferred tools must not widen what a turn can see (#719/#726 trust rules)',
  tags: ['context', 'injection'],
  inbound: { text: '帮我跑一下 ls', scope: 'group', sender: { id: 'member-1', roles: ['user'] } },
  nativeTools: ['bash'],
  workspace: { 'README.md': '# demo\n' },
  script: [{ text: '抱歉，这里不能执行命令。' }],
  expect: {
    systemPromptNotContains: ['- bash'],
    toolsNotCalled: ['bash'],
    modelSteps: 1,
  },
});
