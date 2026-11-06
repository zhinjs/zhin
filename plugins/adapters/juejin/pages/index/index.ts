import { defineCommentReviewPage, definePage } from '@zhin.js/console-contract';
import { spec } from './spec.js';

export const meta = definePage({
  title: '掘金评论审批',
  titleI18n: { en: 'Juejin comment review' },
  icon: 'MessageSquare',
  order: 41,
  requiredPermissions: ['juejin:read'],
});

/**
 * Convention page entry: `pages/index/index.ts` → `/<插件路径>`（如 `/juejin`）。
 * 看登录态和白名单文章、审批 AI 写好的掘金评论回复；采用纯服务端声明式 Blueprint，
 * 数据走插件 RPC（plugin.<pluginId>.status / 动作）。
 */
export default defineCommentReviewPage(spec);
