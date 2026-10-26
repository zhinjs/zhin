import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpointRegistryToken } from '../../../src/bilibili-runtime-state.js';
import { listDraftsText } from '../../../src/review.js';

export default defineCommand({
  description: '查看待审的 B 站评论回复草稿',
  permit: ['role(master)'],
  execute({ use }) {
    return listDraftsText(use(bilibiliEndpointRegistryToken));
  },
});
