import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpointRegistryToken } from '../../../../src/bilibili-runtime-state.js';
import { approveDraftText } from '../../../../src/review.js';

export default defineCommand({
  description: '审批并发出一条 B 站评论草稿',
  permit: ['role(master)'],
  params: { id: { type: 'string', description: '草稿 id（bili-draft list 里方括号内）' } },
  async execute({ params, use }) {
    return await approveDraftText(use(bilibiliEndpointRegistryToken), String(params.id ?? '').trim());
  },
});
