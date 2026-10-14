import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'grep-skips-node-modules',
  description: 'Native grep over the workspace skips node_modules, so dependency code never floods the model context.',
  source: 'QQ: grep scanned node_modules and blew the context (#716 agent-file-tool-hygiene)',
  tags: ['context', 'tool-use'],
  inbound: { text: '哪里定义了 startBot？', sender: { id: 'master', roles: ['master'] } },
  workspace: {
    'src/bot.ts': 'export function startBot() {}\n',
    'node_modules/some-dep/index.js': 'function startBot() { /* vendored */ }\n',
  },
  nativeTools: ['grep'],
  script: [
    { toolCalls: [{ name: 'grep', args: { pattern: 'function startBot', path: '.' } }] },
    { text: 'startBot 定义在 src/bot.ts。' },
  ],
  expect: {
    toolsCalled: ['grep'],
    modelInputContains: ['src/bot.ts'],
    modelInputNotContains: ['some-dep'],
    outboundContains: ['src/bot.ts'],
    modelSteps: 2,
  },
});
