import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpointRegistryToken } from '../../../../src/bilibili-runtime-state.js';
import { editDraftText } from '../../../../src/review.js';

export default defineCommand({
  description: '改写一条 B 站评论草稿（bili-draft edit <id> <新内容>），改完仍需 send',
  permit: ['role(master)'],
  params: { id: { type: 'string', description: '草稿 id' } },
  execute({ params, args, use }) {
    const message = args.join(' ').trim();
    if (!message) return '用法：bili-draft edit <id> <新内容>';
    return editDraftText(use(bilibiliEndpointRegistryToken), String(params.id ?? '').trim(), message);
  },
});
