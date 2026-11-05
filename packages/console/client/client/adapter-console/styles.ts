import { pluginUiStyles } from '../ui/styles.js';

/**
 * 仅供尚未迁移到 `@zhin.js/client/ui` 的 sandbox 页使用的通用兼容样式（`.zhin-console-surface` 下的重置与它用到的两个工具类），
 * 颜色全部来自 Console 主题变量；sandbox 迁移后整段删除。`ac-*` 评论审批样式已随 bilibili / juejin 迁移删除。
 */
const legacyAdapterPageStyles = `
.zhin-console-surface :where(.flex.gap-2) { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.zhin-console-surface :where(.min-w-0) { min-width: 0; }
.zhin-console-surface :where(button, input, textarea, select) { font: inherit; }
.zhin-console-surface :where(button, a, input, textarea, select, summary):focus-visible { outline: var(--zk-focus) solid var(--zk-ring); outline-offset: 2px; }
.zhin-console-surface :where(input:not([type="checkbox"]), textarea, select) { width: 100%; min-width: 0; padding: 8px 12px; border: 1px solid var(--zk-input-line); border-radius: var(--zk-radius-md); background: transparent; color: var(--zk-fg); }
.zhin-console-surface :where(a) { color: var(--zk-primary); text-underline-offset: 3px; overflow-wrap: anywhere; }
.zhin-console-surface :where(h1,h2,h3,p,ul,dl) { margin: 0; }
.zhin-console-surface :where(ul) { list-style: none; padding: 0; }
.zhin-console-surface :where(dd) { margin: 0; }
`;

/** 适配器页面样式：`@zhin.js/client/ui` 套件样式 + sandbox 页的兼容样式。 */
export const adapterConsoleStyles = `${pluginUiStyles}${legacyAdapterPageStyles}`;
