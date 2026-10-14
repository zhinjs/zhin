import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'grep-match-all-rejected',
  description: 'A match-everything grep pattern is refused with a hint to use read_file / glob instead of dumping every line.',
  source: '#716 agent-file-tool-hygiene (grep ".*" flooded the context)',
  tags: ['context', 'tool-use'],
  inbound: { text: '把 src 里的内容都给我看看', sender: { id: 'master', roles: ['master'] } },
  workspace: { 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n' },
  nativeTools: ['grep', 'glob'],
  script: [
    { toolCalls: [{ name: 'grep', args: { pattern: '.*', path: 'src' } }] },
    { toolCalls: [{ name: 'glob', args: { pattern: 'src/**/*.ts' } }] },
    { text: 'src 下有 a.ts 和 b.ts 两个文件，需要看哪个？' },
  ],
  expect: {
    modelInputContains: ['read_file'],
    modelInputNotContains: ['export const b = 2'],
    outboundContains: ['a.ts', 'b.ts'],
    modelSteps: 3,
  },
});
