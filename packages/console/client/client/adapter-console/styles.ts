import { pluginUiStyles } from '../ui/styles.js';

/**
 * 仅供尚未迁移到 `@zhin.js/client/ui` 的页面（bilibili / juejin / sandbox）使用的 `ac-*` 兼容样式，
 * 颜色全部来自 Console 主题变量；这些页面迁移后整段删除。
 */
const legacyAdapterPageStyles = `
.zhin-console-surface :where(.space-y-3) > * + * { margin-top: 12px; }
.zhin-console-surface :where(.flex.gap-2) { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.zhin-console-surface :where(.grow) { flex-grow: 1; }
.zhin-console-surface :where(.min-w-0) { min-width: 0; }
.zhin-console-surface :where(.break-all) { overflow-wrap: anywhere; }
.zhin-console-surface :where(.text-red-600) { color: var(--zk-danger); }
.zhin-console-surface :where(.text-amber-700) { color: var(--zk-warning); }
.zhin-console-surface :where(button, input, textarea, select) { font: inherit; }
.zhin-console-surface :where(button, a, input, textarea, select, summary):focus-visible { outline: var(--zk-focus) solid var(--zk-ring); outline-offset: 2px; }
.zhin-console-surface :where(input:not([type="checkbox"]), textarea, select) { width: 100%; min-width: 0; padding: 8px 12px; border: 1px solid var(--zk-input-line); border-radius: var(--zk-radius-md); background: transparent; color: var(--zk-fg); }
.zhin-console-surface :where(a) { color: var(--zk-primary); text-underline-offset: 3px; overflow-wrap: anywhere; }
.zhin-console-surface :where(h1,h2,h3,p,ul,dl) { margin: 0; }
.zhin-console-surface :where(ul) { list-style: none; padding: 0; }
.zhin-console-surface :where(dd) { margin: 0; }
.zhin-review-page { max-width: 1180px; margin: 0 auto; padding: 32px 28px 48px; }
.ac-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
.ac-identity { display: flex; align-items: center; gap: 14px; min-width: 0; }
.ac-platform-mark { display: grid; place-items: center; width: 48px; height: 48px; flex-shrink: 0; border-radius: var(--zk-radius-lg); background: var(--zk-inset); font-weight: 700; }
.ac-header h1 { font-size: var(--zk-text-title); line-height: 1.25; font-weight: 700; }
.ac-header p { margin-top: 4px; color: var(--zk-muted); }
.ac-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.ac-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: var(--zk-control); padding: 0 14px; border: 1px solid var(--zk-input-line); border-radius: var(--zk-radius-md); background: transparent; color: var(--zk-fg); font-size: var(--zk-text-small); font-weight: 600; cursor: pointer; white-space: nowrap; }
.ac-button:hover:not(:disabled) { background: var(--zk-inset); }
.ac-button-primary { color: var(--zk-on-primary); background: var(--zk-primary); border-color: var(--zk-primary); }
.ac-button-danger { color: var(--zk-danger); border-color: var(--zk-danger); }
.ac-button:disabled { cursor: not-allowed; opacity: .5; }
.ac-badge { display: inline-flex; align-items: center; gap: 6px; border-radius: var(--zk-radius-sm); padding: 1px 8px; font-size: var(--zk-text-small); font-weight: 600; background: var(--zk-inset); color: var(--zk-muted); white-space: nowrap; }
.ac-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.ac-badge-ok { color: var(--zk-success); }
.ac-badge-warn { color: var(--zk-warning); }
.ac-badge-bad { color: var(--zk-danger); }
.ac-notice { border: 1px solid var(--zk-line); border-left: 3px solid var(--zk-success); border-radius: var(--zk-radius-md); padding: 12px 14px; background: var(--zk-surface); margin-bottom: 16px; overflow-wrap: anywhere; }
.ac-notice-error { border-left-color: var(--zk-danger); }
.ac-notice img { display: block; max-height: 224px; max-width: 100%; margin-top: 12px; background: hsl(0 0% 100%); padding: 8px; border-radius: var(--zk-radius-md); }
.ac-empty { border: 1px dashed var(--zk-line); border-radius: var(--zk-radius-lg); padding: 32px 20px; text-align: center; color: var(--zk-muted); }
.ac-empty strong { display: block; color: var(--zk-fg); margin-bottom: 6px; }
.ac-warning { padding: 14px; border: 1px solid var(--zk-line); border-left: 3px solid var(--zk-warning); border-radius: var(--zk-radius-md); background: var(--zk-surface); margin-bottom: 16px; }
.ac-loading { display: grid; gap: 12px; margin-bottom: 24px; color: var(--zk-muted); }
.ac-loading span { display: block; height: 80px; border-radius: var(--zk-radius-lg); background: var(--zk-inset); }
.ac-login-body { display: flex; align-items: flex-start; gap: 24px; }
.ac-review-endpoint { padding: 20px; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg); background: var(--zk-surface); margin-bottom: 24px; }
.ac-review-login { padding-bottom: 20px; border-bottom: 1px solid var(--zk-line); }
.ac-review-login > div { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.ac-review-login p { color: var(--zk-muted); font-size: var(--zk-text-small); margin-top: 8px; }
.ac-review-drafts { margin-top: 24px; }
.ac-review-drafts h3, .ac-review-videos h3 { font-size: var(--zk-text-section); font-weight: 650; }
.ac-review-drafts > div:first-child { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; }
.ac-draft { padding: 18px; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg); margin-top: 12px; background: var(--zk-surface); display: grid; gap: 16px; }
.ac-draft-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: var(--zk-text-small); color: var(--zk-muted); }
.ac-draft-meta a { margin-left: auto; }
.ac-draft-original { border-left: 3px solid var(--zk-line); background: var(--zk-inset); padding: 12px 16px; border-radius: 0 var(--zk-radius-sm) var(--zk-radius-sm) 0; }
.ac-draft-label { font-size: var(--zk-text-small); color: var(--zk-muted); margin-bottom: 8px; }
.ac-draft-body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.75; }
.ac-draft .ac-actions { padding-top: 14px; border-top: 1px solid var(--zk-line); }
.ac-draft .ac-actions .ac-button-danger { margin-left: auto; }
.ac-review-videos { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--zk-line); }
.ac-review-videos ul { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.ac-review-videos a { display: inline-flex; padding: 6px 10px; background: var(--zk-inset); border-radius: var(--zk-radius-sm); text-decoration: none; }
.ac-review-videos p { color: var(--zk-muted); font-size: var(--zk-text-small); }
@media (max-width: 767px) {
  .zhin-review-page { padding: 20px 14px 32px; }
  .ac-header { align-items: flex-start; flex-direction: column; }
  .ac-draft, .ac-review-endpoint { padding: 14px; }
  .ac-login-body { flex-direction: column; }
}
`;

/** 适配器页面样式：`@zhin.js/client/ui` 套件样式 + 尚未迁移页面的兼容样式。 */
export const adapterConsoleStyles = `${pluginUiStyles}${legacyAdapterPageStyles}`;
