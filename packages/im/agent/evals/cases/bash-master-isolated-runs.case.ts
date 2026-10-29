import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'bash-master-isolated-runs',
  description: 'A master DM with the isolated shell policy is offered bash and it runs (canned output, no real shell).',
  source: '#716 ai.agent.masterShell: isolated (baseline for the no-shell cases)',
  tags: ['tool-use'],
  inbound: { text: '跑一下 ls', sender: { id: 'master', roles: ['master'] }, shell: true },
  workspace: { 'README.md': '# demo\n' },
  nativeTools: ['bash'],
  bashOutput: 'README.md\npackage.json',
  script: [
    // bash stays deferred (not in the always-loaded set); a direct call auto-loads it under the turn policy.
    { toolCalls: [{ name: 'bash', args: { command: 'ls' } }] },
    { text: '有 README.md 和 package.json 两个文件。' },
  ],
  expect: {
    toolsCalled: ['bash'],
    outboundContains: ['package.json'],
    modelSteps: 2,
  },
});
