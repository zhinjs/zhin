import { defineEvalCase, live } from '../framework/index.js';

const broken = "import { defineCommand } from 'zhin.js/command';\nexport default defineCommand({ run: () => 'pong' );\n";
const fixed = "import { defineCommand } from 'zhin.js/command';\nexport default defineCommand({ run: () => 'pong' });\n";

/**
 * A draft with a syntax error fails its trial and is closed. The model reads the problems and starts a NEW change
 * (no change_id: a failed change cannot be revised), which passes and is submitted.
 */
export default defineEvalCase({
  id: 'self-change-trial-failed-refix',
  description: 'A draft that FAILS its trial is re-drafted as a new change without reusing the failed change_id; only the new one waits for approval.',
  source: '#1051 F5 (ADR 0040 §3): trial_failed is terminal; the model must start a new change rather than revise the failed one',
  tags: ['tool-use'],
  inbound: { text: '加一个 /ping 指令，回复 pong', sender: { id: 'owner', roles: ['master'] } },
  workspace: { 'package.json': '{"name":"eval-bot","private":true}\n' },
  nativeTools: ['change_draft'],
  script: [
    { toolCalls: [{ name: 'change_draft', args: { files: [{ path: 'commands/ping.ts', content: broken }], summary: '加 /ping 指令' } }] },
    { toolCalls: [{ name: 'change_draft', args: { files: [{ path: 'commands/ping.ts', content: fixed }], summary: '加 /ping 指令（修正语法）' } }] },
    { text: '第一次草稿有语法错误没过试跑，已修正重新起草；新草稿试跑通过，正在等主人审批。' },
  ],
  expect: {
    toolsCalled: ['change_draft'],
    requestInputContains: {
      2: ['FAILED its trial run', 'commands/ping.ts [syntax]', 'WITHOUT change_id'],
      3: ['Submitted for approval'],
    },
    outboundContains: ['等主人审批'],
    selfChangeStatuses: ['trial_failed', 'pending'],
    workspaceFiles: { 'commands/ping.ts': null },
    modelSteps: 3,
  },
  live: {
    checks: (run) => {
      const drafts = run.executedTools.filter((call) => call.name === 'change_draft');
      const reused = drafts.filter((call) => call.args.change_id !== undefined && call.args.change_id !== '');
      return [
        { name: 're-drafted after the failed trial', pass: drafts.length >= 2, ...(drafts.length >= 2 ? {} : { detail: `${drafts.length} change_draft call(s)` }) },
        { name: 'never reuses a change_id', pass: reused.length === 0, ...(reused.length === 0 ? {} : { detail: JSON.stringify(reused.map((call) => call.args.change_id)) }) },
        live.turnsCompleted(run),
      ];
    },
  },
});
