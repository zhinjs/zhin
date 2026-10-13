import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../../src/config.js';
import { keywords } from '../../src/keywords.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  permit: ['group()'],
  description: '查看当前群关键词回复对',
  async execute(context) {
    const entries = await keywords(context.input, context).read();
    if (entries.length === 0) return '当前没有设置任何关键词';
    const lines = entries.map(([k, v], i) => `${i + 1}. 「${k}」→「${v}」`);
    return `关键词列表（共 ${entries.length} 条）：\n${lines.join('\n')}`;
  },
});
