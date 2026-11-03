/** Scoped, dependency-free styles for adapter-owned pages, including remotely loaded entries. */
export const adapterConsoleStyles = `
.zhin-console-surface {
  --ac-canvas: #f8f8f9; --ac-panel: #ffffff; --ac-ink: #242427; --ac-muted: #686870;
  --ac-line: #e3e3e7; --ac-soft: #f0f0f2; --ac-primary: #315fce; --ac-primary-hover: #254ba8;
  --ac-tint: #f0f0f2; --ac-ok: #216c50; --ac-ok-bg: #e7f4ee;
  --ac-warn: #875b13; --ac-warn-bg: #fff4dc; --ac-bad: #b33544; --ac-bad-bg: #fcecf0;
  color: var(--ac-ink); color-scheme: light;
  font-family: 'Avenir Next', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px; line-height: 1.6; text-align: left;
}
.dark .zhin-console-surface, [data-theme="dark"] .zhin-console-surface {
  --ac-canvas: #18181b; --ac-panel: #222225; --ac-ink: #f4f4f5; --ac-muted: #aaaab2;
  --ac-line: #3a3a40; --ac-soft: #2d2d32; --ac-primary: #8eaeff; --ac-primary-hover: #b0c6ff;
  --ac-tint: #2d2d32; --ac-ok: #90d6b5; --ac-ok-bg: #203e36;
  --ac-warn: #edca82; --ac-warn-bg: #403723; --ac-bad: #f4a8b3; --ac-bad-bg: #452c39;
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  .zhin-console-surface:not([data-theme="light"]) {
    --ac-canvas: #18181b; --ac-panel: #222225; --ac-ink: #f4f4f5; --ac-muted: #aaaab2;
    --ac-line: #3a3a40; --ac-soft: #2d2d32; --ac-primary: #8eaeff; --ac-primary-hover: #b0c6ff;
    --ac-tint: #2d2d32; --ac-ok: #90d6b5; --ac-ok-bg: #203e36;
    --ac-warn: #edca82; --ac-warn-bg: #403723; --ac-bad: #f4a8b3; --ac-bad-bg: #452c39;
    color-scheme: dark;
  }
}
.light .zhin-console-surface, [data-theme="light"] .zhin-console-surface, .zhin-console-surface[data-theme="light"] {
  --ac-canvas: #f8f8f9; --ac-panel: #ffffff; --ac-ink: #242427; --ac-muted: #686870;
  --ac-line: #e3e3e7; --ac-soft: #f0f0f2; --ac-primary: #315fce; --ac-primary-hover: #254ba8;
  --ac-tint: #f0f0f2; --ac-ok: #216c50; --ac-ok-bg: #e7f4ee;
  --ac-warn: #875b13; --ac-warn-bg: #fff4dc; --ac-bad: #b33544; --ac-bad-bg: #fcecf0;
  color-scheme: light;
}
.zhin-console-surface *, .zhin-console-surface *::before, .zhin-console-surface *::after { box-sizing: border-box; }
.zhin-console-surface :where(.text-muted-foreground) { color: var(--ac-muted); }
.zhin-console-surface :where(.text-sm) { font-size: 13px; }
.zhin-console-surface :where(.text-xs) { font-size: 12px; }
.zhin-console-surface :where(.space-y-2) > * + * { margin-top: 8px; }
.zhin-console-surface :where(.space-y-3) > * + * { margin-top: 12px; }
.zhin-console-surface :where(.flex.gap-2) { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.zhin-console-surface :where(.grow) { flex-grow: 1; }
.zhin-console-surface :where(.min-w-0) { min-width: 0; }
.zhin-console-surface :where(.break-all) { overflow-wrap: anywhere; }
.zhin-console-surface :where(.text-red-600) { color: var(--ac-bad); }
.zhin-console-surface :where(.text-amber-700) { color: var(--ac-warn); }
.zhin-console-surface :where(button, input, textarea, select) { font: inherit; }
.zhin-console-surface :where(button, a, input, textarea, select, summary):focus-visible { outline: 3px solid var(--ac-primary); outline-offset: 3px; }
.zhin-console-surface :where(input:not([type="checkbox"]), textarea, select) {
  width: 100%; min-width: 0; padding: 10px 12px; border: 1px solid var(--ac-line);
  border-radius: 8px; background: var(--ac-panel); color: var(--ac-ink); line-height: 1.5;
}
.zhin-console-surface :where(input, textarea)::placeholder { color: var(--ac-muted); opacity: .85; }
.zhin-console-surface :where(input, textarea, select):disabled { opacity: .6; cursor: not-allowed; background: var(--ac-soft); }
.zhin-console-surface :where(a) { color: var(--ac-primary); text-underline-offset: 3px; overflow-wrap: anywhere; }
.zhin-console-surface :where(h1,h2,h3,p,ul,dl) { margin: 0; }
.zhin-console-surface :where(ul) { list-style: none; padding: 0; }
.zhin-console-surface :where(dd) { margin: 0; }
.zhin-adapter-page, .zhin-review-page { max-width: 1180px; margin: 0 auto; padding: 36px 32px 48px; }
.ac-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
.ac-identity { display: flex; align-items: center; gap: 16px; min-width: 0; }
.ac-platform-mark { display: grid; place-items: center; width: 56px; height: 56px; flex-shrink: 0; border-radius: 16px; background: var(--ac-tint); color: var(--ac-ink); font-size: 22px; font-weight: 700; letter-spacing: -.05em; }
.ac-header h1 { font-size: clamp(24px, 3vw, 30px); line-height: 1.2; letter-spacing: -.025em; font-weight: 700; overflow-wrap: anywhere; }
.ac-header p { margin-top: 7px; color: var(--ac-muted); max-width: 65ch; }
.ac-header-actions, .ac-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.ac-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 38px; padding: 7px 13px; border: 1px solid var(--ac-line); border-radius: 8px; background: var(--ac-panel); color: var(--ac-ink); font-size: 13px; font-weight: 600; cursor: pointer; transition: background-color .15s, border-color .15s; white-space: nowrap; }
.ac-button:hover:not(:disabled) { background: var(--ac-soft); border-color: var(--ac-muted); }
.ac-button-primary { color: var(--ac-panel); background: var(--ac-primary); border-color: var(--ac-primary); }
.ac-button-primary:hover:not(:disabled) { background: var(--ac-primary-hover); border-color: var(--ac-primary-hover); }
.ac-button-danger { color: var(--ac-bad); }
.ac-button-danger:hover:not(:disabled) { color: var(--ac-bad); background: var(--ac-bad-bg); border-color: var(--ac-bad); }
.ac-button:disabled { cursor: not-allowed; opacity: .45; }
.ac-icon { width: 16px; height: 16px; flex-shrink: 0; }
.ac-badge { display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; padding: 3px 8px; font-size: 12px; font-weight: 600; line-height: 1.5; background: var(--ac-soft); color: var(--ac-muted); white-space: nowrap; }
.ac-badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.ac-badge-ok { background: var(--ac-ok-bg); color: var(--ac-ok); }
.ac-badge-warn { background: var(--ac-warn-bg); color: var(--ac-warn); }
.ac-badge-bad { background: var(--ac-bad-bg); color: var(--ac-bad); }
.ac-notice { border-radius: 10px; padding: 14px 16px; background: var(--ac-ok-bg); color: var(--ac-ok); margin-bottom: 20px; overflow-wrap: anywhere; }
.ac-notice-error { background: var(--ac-bad-bg); color: var(--ac-bad); }
.ac-notice a { color: inherit; }
.ac-notice img { display: block; max-height: 224px; max-width: 100%; margin-top: 12px; background: #fff; padding: 8px; border-radius: 8px; }
.ac-navigation { display: flex; flex-wrap: wrap; gap: 24px; border-bottom: 1px solid var(--ac-line); margin-bottom: 28px; }
.ac-navigation a { display: inline-flex; align-items: center; gap: 8px; padding: 0 0 12px; text-decoration: none; font-weight: 600; color: var(--ac-muted); }
.ac-navigation a:first-child { color: var(--ac-ink); border-bottom: 2px solid var(--ac-primary); }
.ac-navigation span { font-size: 12px; background: var(--ac-soft); padding: 1px 7px; border-radius: 5px; }
.ac-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 28px; align-items: start; }
.ac-workspace-single { grid-template-columns: minmax(0, 1fr); }
.ac-main, .ac-sidebar { min-width: 0; display: grid; gap: 24px; }
.ac-section { min-width: 0; scroll-margin-top: 24px; }
.ac-section-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.ac-section h2 { font-size: 18px; letter-spacing: -.015em; font-weight: 650; }
.ac-section-description { color: var(--ac-muted); font-size: 13px; margin-top: 4px; }
.ac-account-list { display: grid; gap: 12px; }
.ac-account { padding: 20px; border: 1px solid var(--ac-line); border-radius: 12px; background: var(--ac-panel); }
.ac-account-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ac-account-avatar { width: 40px; height: 40px; display: grid; place-items: center; flex-shrink: 0; border-radius: 10px; color: var(--ac-muted); background: var(--ac-tint); }
.ac-account-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.ac-account-title strong { font-size: 16px; font-weight: 650; overflow-wrap: anywhere; }
.ac-account .ac-actions { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--ac-line); }
.ac-account details { margin-top: 14px; font-size: 13px; }
.ac-account summary { width: fit-content; cursor: pointer; color: var(--ac-muted); }
.ac-account details[open] summary { margin-bottom: 12px; }
.ac-details { display: grid; grid-template-columns: minmax(80px, 1fr) minmax(0, 2fr); gap: 7px 16px; font-size: 13px; }
.ac-details dt { color: var(--ac-muted); overflow-wrap: anywhere; }
.ac-details dd { overflow-wrap: anywhere; }
.ac-last-operation { font-size: 12px; color: var(--ac-muted); margin-top: 12px; }
.ac-form { padding: 24px; border: 1px solid var(--ac-line); border-radius: 12px; background: var(--ac-panel); display: grid; gap: 16px; margin-top: 16px; }
.ac-form h3 { font-size: 17px; font-weight: 650; }
.ac-form label { display: grid; gap: 6px; min-width: 0; }
.ac-form label > span:first-child { font-size: 13px; font-weight: 600; }
.ac-form-hint { font-size: 12px; color: var(--ac-muted); }
.ac-required { color: var(--ac-bad); margin-left: 4px; }
.ac-warning { padding: 16px; border: 1px solid var(--ac-line); border-left: 3px solid var(--ac-warn); border-radius: 8px; background: var(--ac-warn-bg); color: var(--ac-warn); margin-bottom: 16px; }
.ac-warning ul { margin-top: 8px; }
.ac-empty { border: 1px dashed var(--ac-line); border-radius: 12px; background: var(--ac-canvas); padding: 36px 24px; text-align: center; color: var(--ac-muted); }
.ac-empty .ac-icon { width: 28px; height: 28px; margin: 0 auto 12px; color: var(--ac-primary); }
.ac-empty p { max-width: 48ch; margin: 0 auto; }
.ac-empty strong { display: block; font-size: 16px; color: var(--ac-ink); margin-bottom: 6px; }
.ac-login-section { margin-bottom: 28px; }
.ac-login { display: grid; gap: 16px; border: 1px solid var(--ac-line); border-left: 3px solid var(--ac-warn); border-radius: 12px; padding: 24px; background: var(--ac-panel); }
.ac-login-list { display: grid; gap: 12px; }
.ac-login-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.ac-login-head time { margin-left: auto; color: var(--ac-muted); font-size: 12px; }
.ac-login-body { display: flex; align-items: flex-start; gap: 24px; }
.ac-login-body img { width: 176px; max-width: 100%; height: auto; border: 1px solid var(--ac-line); border-radius: 10px; background: #fff; padding: 10px; flex-shrink: 0; }
.ac-login-content { display: grid; gap: 14px; flex: 1; min-width: 0; }
.ac-login-content p { white-space: pre-wrap; overflow-wrap: anywhere; }
.ac-login-input { display: flex; flex-wrap: wrap; gap: 8px; }
.ac-login-input input { flex: 1; min-width: 160px; }
.ac-tool-list { display: grid; gap: 12px; }
.ac-tool { display: grid; gap: 14px; padding: 20px; border: 1px solid var(--ac-line); border-radius: 12px; background: var(--ac-canvas); }
.ac-tool h3 { font-size: 14px; font-weight: 650; }
.ac-tool p { font-size: 13px; color: var(--ac-muted); }
.ac-tool label { display: grid; gap: 6px; font-size: 13px; }
.ac-tool-result { padding: 12px; background: var(--ac-soft); border-radius: 8px; font-size: 13px; overflow-wrap: anywhere; }
.ac-tool-result img { max-height: 224px; max-width: 100%; background: #fff; }
.ac-platform-status { padding: 20px; border-radius: 12px; background: var(--ac-canvas); border: 1px solid var(--ac-line); }
.ac-platform-status h2 { margin-bottom: 16px; }
.ac-footnote { display: flex; align-items: center; gap: 8px; color: var(--ac-muted); font-size: 12px; margin-top: 24px; }
.ac-loading { display: grid; gap: 12px; margin-bottom: 24px; }
.ac-loading span { display: block; height: 100px; border: 1px solid var(--ac-line); border-radius: 12px; background: var(--ac-soft); }
.ac-loading p { color: var(--ac-muted); }
.ac-review-endpoint { padding: 24px; border: 1px solid var(--ac-line); border-radius: 14px; background: var(--ac-panel); margin-bottom: 24px; }
.ac-review-login { padding-bottom: 20px; border-bottom: 1px solid var(--ac-line); }
.ac-review-login > div { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.ac-review-login p { color: var(--ac-muted); font-size: 13px; margin-top: 8px; }
.ac-review-drafts { margin-top: 24px; }
.ac-review-drafts h3, .ac-review-videos h3 { font-size: 16px; font-weight: 650; }
.ac-review-drafts > div:first-child { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; }
.ac-draft { padding: 22px; border: 1px solid var(--ac-line); border-radius: 12px; margin-top: 12px; background: var(--ac-panel); display: grid; gap: 18px; }
.ac-draft-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 12px; color: var(--ac-muted); }
.ac-draft-meta a { margin-left: auto; }
.ac-draft-original { border-left: 3px solid var(--ac-line); background: var(--ac-canvas); padding: 12px 16px; border-radius: 0 8px 8px 0; }
.ac-draft-label { font-size: 12px; color: var(--ac-muted); margin-bottom: 8px; }
.ac-draft-body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.75; }
.ac-draft .ac-actions { padding-top: 16px; border-top: 1px solid var(--ac-line); }
.ac-draft .ac-actions .ac-button-danger { margin-left: auto; }
.ac-review-videos { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--ac-line); }
.ac-review-videos ul { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.ac-review-videos a { display: inline-flex; padding: 6px 10px; background: var(--ac-soft); border-radius: 6px; text-decoration: none; }
.ac-review-videos p { color: var(--ac-muted); font-size: 12px; }
@media (max-width: 960px) { .ac-workspace { grid-template-columns: minmax(0, 1fr); } .ac-sidebar { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) {
  .zhin-adapter-page, .zhin-review-page { padding: 24px 16px 32px; }
  .ac-header { align-items: flex-start; flex-direction: column; gap: 16px; }
  .ac-header-actions { width: 100%; }
  .ac-header-actions .ac-button-primary { margin-left: auto; }
  .ac-platform-mark { width: 48px; height: 48px; border-radius: 13px; }
  .ac-navigation { gap: 20px; }
  .ac-account, .ac-form, .ac-login, .ac-review-endpoint, .ac-draft { padding: 16px; }
  .ac-sidebar { grid-template-columns: minmax(0, 1fr); }
  .ac-login-body { flex-direction: column; }
  .ac-login-content { width: 100%; }
  .ac-details { grid-template-columns: minmax(70px, 1fr) minmax(0, 2fr); }
}
@media (prefers-reduced-motion: reduce) { .zhin-console-surface *, .zhin-console-surface *::before, .zhin-console-surface *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
`;
