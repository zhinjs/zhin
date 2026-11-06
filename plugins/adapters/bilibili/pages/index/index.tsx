import { definePage } from '@zhin.js/console-contract';
import { createCommentReviewPage } from '@zhin.js/client';
import { spec } from './spec.js';

export const meta = definePage({
  title: '评论审批',
  titleI18n: { en: 'Comment review' },
  icon: 'MessageSquare',
  order: 40,
  requiredPermissions: ['bilibili:read'],
});

/**
 * Convention page entry: `pages/index/index.tsx` → `/<插件路径>`（如 `/bilibili`）。
 * 扫码登录、看白名单视频、审批 AI 写好的 B 站评论回复；页面本体是 `@zhin.js/client` 的 `createCommentReviewPage`，
 * 数据走插件 RPC（plugin.<pluginId>.status / 动作）。
 */
export default createCommentReviewPage(spec);
