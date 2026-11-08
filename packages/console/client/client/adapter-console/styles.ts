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
.zhin-console-surface .zk-platform-banner { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg); background: var(--zk-surface-muted); }
.zhin-console-surface .zk-platform-banner__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.zhin-console-surface .zk-platform-steps { display: flex; gap: 8px; flex-wrap: wrap; }
.zhin-console-surface .zk-platform-step { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--zk-line); background: var(--zk-surface); font-size: 12px; color: var(--zk-fg-muted); }
.zhin-console-surface .zk-mode-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0; }
.zhin-console-surface .zk-mode-tab { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 12px; border-radius: var(--zk-radius-md); border: 1px solid var(--zk-line); background: var(--zk-surface); color: var(--zk-fg); cursor: pointer; text-align: left; transition: border-color 120ms ease, background 120ms ease; }
.zhin-console-surface .zk-mode-tab[aria-pressed="true"] { border-color: var(--zk-primary); background: var(--zk-primary-soft); }
.zhin-console-surface .zk-preset-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; margin: 4px 0; }
.zhin-console-surface .zk-preset-card { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px 12px; border-radius: var(--zk-radius-md); border: 1px solid var(--zk-line); background: var(--zk-surface-muted); color: var(--zk-fg); cursor: pointer; text-align: left; }
.zhin-console-surface .zk-preset-card:hover { border-color: var(--zk-primary); }
.zhin-console-surface .zk-callback-box { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 12px; border-radius: var(--zk-radius-md); border: 1px dashed var(--zk-primary); background: var(--zk-primary-soft); font-size: 12.5px; }
.zhin-console-surface .zk-callback-box code { font-family: var(--zk-mono); font-weight: 600; color: var(--zk-fg); }
.zhin-console-surface .zk-option-pills { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.zhin-console-surface .zk-chip-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--zk-line); background: var(--zk-surface-muted); color: var(--zk-fg-muted); font-size: 12px; cursor: pointer; }
.zhin-console-surface .zk-chip-btn:hover, .zhin-console-surface .zk-chip-btn[aria-pressed="true"] { border-color: var(--zk-primary); color: var(--zk-primary); background: var(--zk-primary-soft); }
.zhin-console-surface .zk-group-header { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--zk-line); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--zk-fg-subtle); }
.zhin-console-surface .zk-account-pills { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.zhin-console-surface .zk-account-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--zk-line); background: var(--zk-surface-muted); font-size: 11.5px; color: var(--zk-fg-muted); }
.zhin-console-surface .zk-login-steps { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.zhin-console-surface .zk-login-step { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; border: 1px solid var(--zk-line); color: var(--zk-fg-muted); }
.zhin-console-surface .zk-login-step--active { border-color: var(--zk-warning); background: var(--zk-warning-soft); color: var(--zk-warning); font-weight: 600; }
.zhin-console-surface .zk-qq-workbench { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border: 1px solid var(--zk-primary); border-radius: var(--zk-radius-lg); background: var(--zk-primary-soft); }
.zhin-console-surface .zk-qq-kind-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
`;

/** 适配器页面样式：`@zhin.js/client/ui` 套件样式 + sandbox 页的兼容样式。 */
export const adapterConsoleStyles = `${pluginUiStyles}${legacyAdapterPageStyles}`;
