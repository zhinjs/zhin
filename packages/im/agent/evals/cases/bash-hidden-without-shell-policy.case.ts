import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'bash-hidden-without-shell-policy',
  description: 'A turn whose policy cannot run a shell is never offered bash; a stray bash call does not execute.',
  source: 'QQ: bash unavailable but the model kept trying it (#716 agent-im-bash-policy)',
  tags: ['tool-use'],
  inbound: { text: '帮我跑一下 ls 看看有哪些文件' },
  workspace: { 'README.md': '# demo\n' },
  nativeTools: ['bash', 'list_dir'],
  bashOutput: 'README.md',
  script: [
    { toolCalls: [{ name: 'bash', args: { command: 'ls' }, notOffered: true }] },
    { toolCalls: [{ name: 'list_dir', args: { path: '.' }, notOffered: true }] },
    { text: '目录里有 README.md。' },
  ],
  expect: {
    toolsNotCalled: ['bash'],
    toolsCalled: ['list_dir'],
    outboundContains: ['README.md'],
    modelSteps: 3,
  },
});
