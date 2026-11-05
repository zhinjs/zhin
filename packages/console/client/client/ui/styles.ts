/**
 * 插件页 UI 套件样式（一份字符串，用 `<style>{pluginUiStyles}</style>` 注入）。
 * 只使用 Console 主题变量（带回退值），不依赖 Tailwind 工具类，类名统一 `zk-` 前缀。
 * 暗色由 Console 切换 `.dark` 时变量自动变化，这里不再维护私有调色板。
 */
export const pluginUiStyles = `
.zk-root, .zhin-console-surface {
  --zk-fg: hsl(var(--foreground, 0 0% 12%));
  --zk-muted: hsl(var(--muted-foreground, 0 0% 39%));
  --zk-line: hsl(var(--border, 0 0% 90%));
  --zk-input-line: hsl(var(--input, 0 0% 57%));
  --zk-surface: hsl(var(--foreground, 0 0% 12%) / .035);
  --zk-inset: hsl(var(--foreground, 0 0% 12%) / .055);
  --zk-primary: hsl(var(--primary, 222 62% 50%));
  --zk-on-primary: hsl(var(--primary-foreground, 0 0% 99%));
  --zk-ring: hsl(var(--ring, 222 62% 50%));
  --zk-success: hsl(var(--status-success, 145 52% 28%));
  --zk-warning: hsl(var(--status-warning, 32 80% 30%));
  --zk-danger: hsl(var(--status-danger, 0 68% 42%));
  --zk-info: hsl(var(--status-info, 222 62% 50%));
  --zk-radius-sm: var(--console-radius-sm, 8px);
  --zk-radius-md: var(--console-radius-md, 10px);
  --zk-radius-lg: var(--console-radius-lg, 14px);
  --zk-text-body: var(--console-text-body, 14px);
  --zk-text-small: var(--console-text-label, 13px);
  --zk-text-title: var(--console-text-title, 28px);
  --zk-text-section: var(--console-text-section, 16px);
  --zk-control: var(--console-control-height, 36px);
  --zk-control-sm: var(--console-control-height-sm, 32px);
  --zk-focus: var(--console-focus-width, 2px);
  color: var(--zk-fg);
  font-family: var(--console-font-sans, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif);
  font-size: var(--zk-text-body); line-height: 1.6; text-align: left;
}
@media (max-width: 767px) {
  .zk-root, .zhin-console-surface {
    --zk-text-body: var(--console-text-body, 13px); --zk-text-small: var(--console-text-label, 12px);
    --zk-text-title: var(--console-text-title, 22px); --zk-control: var(--console-control-height, 44px);
    --zk-control-sm: var(--console-control-height-sm, 44px);
    --zk-radius-sm: var(--console-radius-sm, 6px); --zk-radius-md: var(--console-radius-md, 8px); --zk-radius-lg: var(--console-radius-lg, 12px);
  }
}
@media (min-width: 768px) and (max-width: 1199px) {
  .zk-root, .zhin-console-surface { --zk-text-title: var(--console-text-title, 24px); --zk-control-sm: var(--console-control-height-sm, 36px); }
}
.zk-root :where(h1, h2, h3, p, ul, dl, pre) { margin: 0; }
.zk-root :where(ul) { list-style: none; padding: 0; }
.zk-root :where(dd) { margin: 0; }
.zk-root :where(button, input, select, textarea) { font: inherit; }
.zk-root :where(a) { color: var(--zk-primary); text-underline-offset: 3px; overflow-wrap: anywhere; }
.zk-root :where(button, a, input, select, textarea, summary):focus-visible { outline: var(--zk-focus) solid var(--zk-ring); outline-offset: 2px; }
.zk-root :where(input:not([type="checkbox"]):not([type="radio"]), select, textarea) {
  width: 100%; min-width: 0; min-height: var(--zk-control); padding: 6px 12px; box-sizing: border-box;
  border: 1px solid var(--zk-input-line); border-radius: var(--zk-radius-md); background: transparent; color: var(--zk-fg);
}
.zk-root :where(input, textarea)::placeholder { color: var(--zk-muted); }
.zk-root :where(input, select, textarea):disabled { opacity: .6; cursor: not-allowed; }
.zk-root :where(input, select, textarea)[aria-invalid="true"] { border-color: var(--zk-danger); }
.zk-page { max-width: 1180px; margin: 0 auto; padding: 32px 28px 48px; display: grid; gap: 24px; }
.zk-page-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.zk-page-header__identity { display: flex; align-items: center; gap: 14px; min-width: 0; }
.zk-page-header h1 { font-size: var(--zk-text-title); line-height: 1.25; font-weight: 700; overflow-wrap: anywhere; }
.zk-page-header p { margin-top: 4px; color: var(--zk-muted); max-width: 65ch; }
.zk-mark { display: grid; place-items: center; width: 48px; height: 48px; flex-shrink: 0; border-radius: var(--zk-radius-lg); background: var(--zk-inset); font-weight: 700; }
.zk-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.zk-stack { display: grid; gap: 12px; min-width: 0; }
.zk-grow { flex-grow: 1; }
.zk-section { min-width: 0; scroll-margin-top: 24px; display: grid; gap: 12px; align-content: start; }
.zk-section__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.zk-section h2 { font-size: var(--zk-text-section); font-weight: 650; }
.zk-hint { font-size: var(--zk-text-small); color: var(--zk-muted); }
.zk-card { padding: 16px; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg); background: var(--zk-surface); display: grid; gap: 12px; min-width: 0; }
.zk-list { display: grid; gap: 12px; }
.zk-dl { display: grid; grid-template-columns: minmax(80px, 1fr) minmax(0, 2fr); gap: 6px 16px; font-size: var(--zk-text-small); }
.zk-dl dt { color: var(--zk-muted); overflow-wrap: anywhere; }
.zk-dl dd { overflow-wrap: anywhere; }
.zk-nav { display: flex; flex-wrap: wrap; gap: 8px 20px; border-bottom: 1px solid var(--zk-line); }
.zk-nav a { display: inline-flex; align-items: center; gap: 6px; min-height: var(--zk-control-sm); color: var(--zk-fg); text-decoration: none; font-weight: 600; }
.zk-nav a:hover { text-decoration: underline; }
.zk-count { font-size: var(--zk-text-small); background: var(--zk-inset); padding: 0 6px; border-radius: var(--zk-radius-sm); color: var(--zk-muted); }
.zk-footnote { color: var(--zk-muted); font-size: var(--zk-text-small); }
.zk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: var(--zk-control); padding: 0 14px; box-sizing: border-box;
  border: 1px solid var(--zk-input-line); border-radius: var(--zk-radius-md); background: transparent; color: var(--zk-fg);
  font-size: var(--zk-text-small); font-weight: 600; cursor: pointer; white-space: nowrap; text-decoration: none; transition: background-color .14s, border-color .14s; }
.zk-btn:hover:not(:disabled) { background: var(--zk-inset); }
.zk-btn--primary { background: var(--zk-primary); border-color: var(--zk-primary); color: var(--zk-on-primary); }
.zk-btn--primary:hover:not(:disabled) { background: var(--zk-primary); filter: brightness(.92); }
.zk-btn--ghost { border-color: transparent; }
.zk-btn--danger { background: hsl(var(--destructive, 0 68% 42%)); border-color: hsl(var(--destructive, 0 68% 42%)); color: hsl(var(--destructive-foreground, 0 0% 100%)); }
.zk-btn--danger:hover:not(:disabled) { background: hsl(var(--destructive, 0 68% 42%)); filter: brightness(.92); }
.zk-btn--sm { min-height: var(--zk-control-sm); padding: 0 10px; }
.zk-btn--icon { min-height: var(--zk-control-sm); min-width: var(--zk-control-sm); padding: 0; }
.zk-btn:disabled { cursor: not-allowed; opacity: .5; }
.zk-btn[aria-busy="true"] { opacity: 1; cursor: progress; }
.zk-spinner { width: 14px; height: 14px; flex-shrink: 0; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: zk-spin .8s linear infinite; }
@keyframes zk-spin { to { transform: rotate(360deg); } }
.zk-badge { display: inline-flex; align-items: center; gap: 6px; padding: 1px 8px; border-radius: var(--zk-radius-sm); font-size: var(--zk-text-small); font-weight: 600; line-height: 1.6; white-space: nowrap; background: var(--zk-inset); color: var(--zk-muted); }
.zk-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.zk-badge--success { background: hsl(var(--status-success, 145 52% 28%) / .12); color: var(--zk-success); }
.zk-badge--warning { background: hsl(var(--status-warning, 32 80% 30%) / .14); color: var(--zk-warning); }
.zk-badge--danger { background: hsl(var(--status-danger, 0 68% 42%) / .12); color: var(--zk-danger); }
.zk-badge--info { background: hsl(var(--status-info, 222 62% 50%) / .12); color: var(--zk-info); }
.zk-notice { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid var(--zk-line); border-left-width: 3px; border-radius: var(--zk-radius-md); background: var(--zk-surface); overflow-wrap: anywhere; }
.zk-notice__body { display: grid; gap: 4px; min-width: 0; }
.zk-notice__title { font-weight: 650; }
.zk-notice--info { border-left-color: var(--zk-info); }
.zk-notice--success { border-left-color: var(--zk-success); }
.zk-notice--warning { border-left-color: var(--zk-warning); }
.zk-notice--danger { border-left-color: var(--zk-danger); }
.zk-empty { display: grid; justify-items: center; gap: 6px; text-align: center; padding: 32px 20px; border: 1px dashed var(--zk-line); border-radius: var(--zk-radius-lg); color: var(--zk-muted); }
.zk-empty strong { color: var(--zk-fg); font-size: var(--zk-text-section); }
.zk-empty p { max-width: 48ch; }
.zk-empty__icon { display: inline-flex; color: var(--zk-primary); }
.zk-loading { display: grid; gap: 10px; }
.zk-loading p { color: var(--zk-muted); }
.zk-loading__block { display: block; height: 72px; border-radius: var(--zk-radius-lg); background: var(--zk-inset); }
.zk-error { display: grid; gap: 8px; justify-items: start; padding: 16px; border: 1px solid var(--zk-danger); border-radius: var(--zk-radius-lg); background: hsl(var(--status-danger, 0 68% 42%) / .06); }
.zk-error p { max-width: 70ch; }
.zk-error details { font-size: var(--zk-text-small); color: var(--zk-muted); max-width: 100%; }
.zk-error summary { cursor: pointer; min-height: var(--zk-control-sm); display: flex; align-items: center; }
.zk-error pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.zk-confirm { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 6px 8px; border: 1px solid var(--zk-danger); border-radius: var(--zk-radius-md); background: hsl(var(--status-danger, 0 68% 42%) / .06); }
.zk-confirm__message { font-size: var(--zk-text-small); overflow-wrap: anywhere; max-width: 36ch; }
.zk-field { display: grid; gap: 6px; min-width: 0; }
.zk-field__label { font-size: var(--zk-text-small); font-weight: 600; }
.zk-field__error { font-size: var(--zk-text-small); color: var(--zk-danger); }
.zk-qr { display: block; width: 176px; max-width: 100%; height: auto; padding: 10px; box-sizing: border-box; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-md);
  /* QR 码必须黑码白底才能被扫码器识别，暗色主题下也不能跟随主题变量。 */
  background: hsl(0 0% 100%); }
.zk-media { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 20px; }
.zk-media__body { display: grid; gap: 12px; flex: 1; min-width: min(240px, 100%); }
.zk-split { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 24px; align-items: start; }
.zk-split--single { grid-template-columns: minmax(0, 1fr); }
.zk-account__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.zk-account__head strong { font-size: var(--zk-text-section); overflow-wrap: anywhere; }
.zk-card details { font-size: var(--zk-text-small); }
.zk-card summary { cursor: pointer; width: fit-content; min-height: var(--zk-control-sm); display: flex; align-items: center; color: var(--zk-muted); }
.zk-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 959px) { .zk-split { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 767px) {
  .zk-page { padding: 20px 14px 32px; }
  .zk-btn--icon { min-width: 44px; min-height: 44px; }
  .zk-dl { grid-template-columns: minmax(70px, 1fr) minmax(0, 2fr); }
}
@media (prefers-reduced-motion: reduce) {
  .zk-root *, .zk-root *::before, .zk-root *::after { transition: none !important; scroll-behavior: auto !important; }
  .zk-spinner { animation: none; border-right-color: currentColor; border-style: dotted; }
}
`;
