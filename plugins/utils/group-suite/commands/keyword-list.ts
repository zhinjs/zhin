import { defineCommand } from '@zhin.js/command';
import { listKeywords } from '../src/keyword-store.js';
import type { GroupSuiteConfig } from '../src/config.js';

export default defineCommand<GroupSuiteConfig>({
  description: '查看所有关键词回复对',
  execute() {
    const entries = listKeywords();
    if (entries.length === 0) return '当前没有设置任何关键词';
    const lines = entries.map(([k, v], i) => `${i + 1}. 「${k}」→「${v}」`);
    return `关键词列表（共 ${entries.length} 条）：\n${lines.join('\n')}`;
  },
});
