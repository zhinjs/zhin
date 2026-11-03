import { defineEvalCase, live } from '../framework/index.js';

// Fixture-only specifier (written into a sandbox plugin file); built at runtime so
// check:architecture does not treat it as an agent-layer import of zhin.js.
const CMD_MODULE = ['zhin.js', 'command'].join('/');

const ping = "import { defineCommand } from '" + CMD_MODULE + "';\nexport default defineCommand({ run: () => 'pong' });\n";
const hello = "import { defineCommand } from '" + CMD_MODULE + "';\nexport default defineCommand({ run: () => 'hello' });\n";

/**
 * This conversation already has a change waiting for the owner's approval (one pending change per conversation).
 * A new request is not drafted: the tool says so, and the model tells the user the earlier change is still waiting.
 */
export default defineEvalCase({
  id: 'self-change-waiting-no-new-draft',
  description: 'With a change from this conversation still pending, a new request drafts nothing and the reply says the earlier change waits for approval.',
  source: '#1051 F5 (ADR 0040 §4): at most one pending self-change per conversation',
  tags: ['tool-use', 'approval'],
  inbound: { text: '再加一个 /hello 指令', sender: { id: 'owner', roles: ['master'] } },
  workspace: { 'package.json': '{"name":"eval-bot","private":true}\n' },
  nativeTools: ['change_draft', 'write_file'],
  selfChange: { pending: { summary: '加 /ping 指令', files: [{ path: 'commands/ping.ts', content: ping }] } },
  script: [
    { toolCalls: [{ name: 'change_draft', args: { files: [{ path: 'commands/hello.ts', content: hello }], summary: '加 /hello 指令' } }] },
    { text: '上一个变更（/ping）还在等主人审批，审批完我再起草 /hello。' },
  ],
  expect: {
    toolsNotCalled: ['write_file'],
    requestInputContains: { 2: ['still waiting for the owner', 'no new change was drafted'] },
    outboundContains: ['等主人审批'],
    selfChangeStatuses: ['pending'],
    workspaceFiles: { 'commands/hello.ts': null },
    modelSteps: 2,
  },
  live: {
    checks: (run) => [
      live.notExecuted(run, 'write_file'),
      live.replyMatches(run, /审批|批准|等/, 'reply says the earlier change is waiting'),
      { name: 'no new change drafted', pass: run.selfChanges.length === 1, ...(run.selfChanges.length === 1 ? {} : { detail: JSON.stringify(run.selfChanges) }) },
      live.turnsCompleted(run),
    ],
  },
});
