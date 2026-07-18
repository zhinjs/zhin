import { defineCommand } from '@zhin.js/command';
import { addKeyword } from '../../src/keyword-store.js';
import type { GroupSuiteConfig } from '../../src/config.js';

export default defineCommand<GroupSuiteConfig>({
  description: '添加关键词自动回复',
  execute({ params, args }) {
    const keyword = String(params.keyword ?? '');
    const reply = args.join(' ').trim();
    if (!keyword || !reply) return '请提供关键词和回复内容';
    addKeyword(keyword, reply);
    return `已添加关键词「${keyword}」→「${reply}」`;
  },
});
