import { defineEvalCase } from '../framework/index.js';

/** #718: a synchronous sub-agent runs inside the QQ turn and only the parent talks to the user. */
export default defineEvalCase({
  id: 'subagent-sync-report',
  description: 'Master DM: the parent delegates to a sync sub-agent and relays its report in its own words.',
  source: '#718 sync sub-agents on the plugin-runtime path',
  tags: ['subagent', 'long-task'],
  inbound: { text: '帮我看看 README 里写的启动命令是什么', sender: { id: 'master', roles: ['master'] } },
  agentConfig: { subagentTurnMode: 'sync' },
  tools: [
    { name: 'read_doc', description: 'Read a project document.', result: '# zhin\n\nStart the bot with: pnpm dev (internal-marker-7f3a)' },
  ],
  script: [
    // Parent: delegate.
    { toolCalls: [{ name: 'spawn_task', args: { task: 'Read README.md and report the start command.' } }] },
    // Sub-agent: read, then report back to the parent.
    { toolCalls: [{ name: 'read_doc', args: { path: 'README.md' } }] },
    { text: 'README says the start command is `pnpm dev`.' },
    // Parent: answer the user.
    { text: 'README 里的启动命令是 `pnpm dev`。' },
  ],
  expect: {
    toolsCalled: ['read_doc'],
    outboundContains: ['pnpm dev'],
    outboundNotContains: ['internal-marker-7f3a', 'README says'],
    noRawToolOutput: true,
    termination: 'turn_end',
    modelSteps: 4,
  },
});
