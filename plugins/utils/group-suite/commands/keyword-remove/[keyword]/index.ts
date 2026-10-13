import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../../../src/config.js';
import { keywords } from '../../../src/keywords.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  permit: ['group()', 'role(owner,admin,master,trusted)'],
  description: '删除当前群关键词自动回复',
  params: { keyword: { type: 'string' } },
  async execute(context) {
    const keyword = String(context.params.keyword ?? '');
    if (!keyword) return '请提供要删除的关键词';
    const repository = keywords(context.input, context);
    if (!(await repository.read()).some(([entry]) => entry === keyword)) return `关键词「${keyword}」不存在`;
    await repository.update(store => { store.delete(keyword); });
    return `已删除关键词「${keyword}」`;
  },
});
