import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpointRegistryToken } from '../../../../src/bilibili-runtime-state.js';
import { discardDraftText } from '../../../../src/review.js';

export default defineCommand({
  description: '丢弃一条 B 站评论草稿（不发送）',
  permit: ['role(master)'],
  params: { id: { type: 'string', description: '草稿 id（bili-draft list 里方括号内）' } },
  execute({ params, use }) {
    return discardDraftText(use(bilibiliEndpointRegistryToken), String(params.id ?? '').trim());
  },
});
