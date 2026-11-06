import { definePage } from '@zhin.js/console-contract';
import { createCommentReviewPage } from '@zhin.js/client';
import { spec } from './spec.js';

export const meta = definePage({
  title: '掘金评论审批',
  titleI18n: { en: 'Juejin comment review' },
  icon: 'MessageSquare',
  order: 41,
  requiredPermissions: ['juejin:read'],
});

/**
 * Convention page entry: `pages/index/index.tsx` → `/<插件路径>`（如 `/juejin`）。
 * 看登录态和白名单文章、审批 AI 写好的掘金评论回复；页面本体是 `@zhin.js/client` 的 `createCommentReviewPage`，
 * 数据走插件 RPC（plugin.<pluginId>.status / 动作）。
 */
export default createCommentReviewPage(spec);
