import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'subagent-no-bash-when-parent-cannot',
  description: 'A sync sub-agent inherits the parent policy: no shell for the parent means no bash for the child.',
  source: 'QQ: sub-agent overreach — child had tools the parent turn could not use (#718 deriveSubagentPolicy)',
  tags: ['subagent', 'tool-use'],
  inbound: { text: '让子任务帮我看看目录结构', sender: { id: 'u1', roles: ['user'] } },
  agentConfig: { subagentTurnMode: 'sync' },
  workspace: { 'README.md': '# demo\n', 'src/index.ts': 'export {};\n' },
  nativeTools: ['bash', 'list_dir'],
  script: [
    { toolCalls: [{ name: 'spawn_task', args: { task: 'List the repository layout.' }, notOffered: true }] },
    // Child: bash is withheld, so it falls back to list_dir.
    { toolCalls: [{ name: 'bash', args: { command: 'ls -R' }, notOffered: true }] },
    { toolCalls: [{ name: 'list_dir', args: { path: '.' } }] },
    { text: 'Top level: README.md and src/.' },
    { text: '根目录有 README.md 和 src/。' },
  ],
  expect: {
    toolsNotCalled: ['bash'],
    toolsCalled: ['list_dir'],
    outboundContains: ['src/'],
    modelSteps: 5,
  },
});
