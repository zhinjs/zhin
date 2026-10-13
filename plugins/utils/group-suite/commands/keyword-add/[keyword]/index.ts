import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../../../src/config.js';
import { keywords } from '../../../src/keywords.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  permit: ['group()', 'role(owner,admin,master,trusted)'],
  description: '添加当前群关键词自动回复',
  params: { keyword: { type: 'string' } },
  async execute(context) {
    const keyword = String(context.params.keyword ?? '');
    const reply = context.args.join(' ').trim();
    if (!keyword || !reply) return '请提供关键词和回复内容';
    await keywords(context.input, context).update(store => { store.set(keyword, reply); });
    return `已添加关键词「${keyword}」→「${reply}」`;
  },
});
