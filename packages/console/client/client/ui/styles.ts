/**
 * 插件页与 Console 通用 UI 套件样式（一份字符串，用 `<style>{pluginUiStyles}</style>` 注入）。
 * 只使用 Console 主题变量（带回退值），不依赖 Tailwind 工具类，类名统一 `zk-` 前缀。
 * 暗色由 Console 切换 `.dark` 时变量自动变化，自适应桌面与移动端。
 */
export const pluginUiStyles = `
.zk-root, .zhin-console-surface {
  --zk-fg: hsl(var(--foreground, 224 20% 12%));
  --zk-muted: hsl(var(--muted-foreground, 220 10% 42%));
  --zk-line: hsl(var(--border, 220 14% 89%));
  --zk-input-line: hsl(var(--input, 220 12% 72%));
  --zk-surface: hsl(var(--foreground, 224 20% 12%) / .03);
  --zk-elevated: hsl(var(--background, 0 0% 100%));
  --zk-inset: hsl(var(--foreground, 224 20% 12%) / .055);
  --zk-primary: hsl(var(--primary, 173 80% 36%));
  --zk-on-primary: hsl(var(--primary-foreground, 0 0% 99%));
  --zk-ring: hsl(var(--ring, 173 80% 36%));
  --zk-success: hsl(var(--status-success, 152 62% 32%));
  --zk-warning: hsl(var(--status-warning, 35 88% 36%));
  --zk-danger: hsl(var(--status-danger, 0 72% 46%));
  --zk-info: hsl(var(--status-info, 217 78% 52%));
  --zk-radius-xs: 5px;
  --zk-radius-sm: var(--console-radius-sm, 8px);
  --zk-radius-md: var(--console-radius-md, 10px);
  --zk-radius-lg: var(--console-radius-lg, 14px);
  --zk-radius-xl: 18px;
  --zk-shadow-sm: 0 1px 2px hsl(220 20% 10% / .04), 0 1px 3px hsl(220 20% 10% / .03);
  --zk-shadow-md: 0 4px 12px -2px hsl(220 20% 10% / .07), 0 2px 6px -1px hsl(220 20% 10% / .04);
  --zk-shadow-lg: 0 16px 36px -6px hsl(220 20% 10% / .14), 0 6px 14px -3px hsl(220 20% 10% / .08);
  --zk-text-body: var(--console-text-body, 14px);
  --zk-text-small: var(--console-text-label, 13px);
  --zk-text-xs: 12px;
  --zk-text-title: var(--console-text-title, 26px);
  --zk-text-section: var(--console-text-section, 16px);
  --zk-control: var(--console-control-height, 36px);
  --zk-control-sm: var(--console-control-height-sm, 30px);
  --zk-control-lg: 42px;
  --zk-focus: var(--console-focus-width, 2px);
  --zk-font-mono: ui-monospace, 'SFMono-Regular', 'JetBrains Mono', Menlo, Monaco, Consolas, monospace;
  color: var(--zk-fg);
  font-family: var(--console-font-sans, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif);
  font-size: var(--zk-text-body); line-height: 1.6; text-align: left;
}
html.dark .zk-root, .dark .zk-root, html.dark .zhin-console-surface, .dark .zhin-console-surface {
  --zk-fg: hsl(var(--foreground, 0 0% 96%));
  --zk-muted: hsl(var(--muted-foreground, 240 5% 65%));
  --zk-line: hsl(var(--border, 240 4% 18%));
  --zk-input-line: hsl(var(--input, 240 4% 26%));
  --zk-surface: hsl(var(--foreground, 0 0% 96%) / .035);
  --zk-elevated: hsl(var(--background, 240 6% 10%));
  --zk-inset: hsl(var(--foreground, 0 0% 96%) / .065);
  --zk-primary: hsl(var(--primary, 172 66% 50%));
  --zk-on-primary: hsl(var(--primary-foreground, 176 80% 10%));
  --zk-ring: hsl(var(--ring, 172 66% 50%));
  --zk-success: hsl(var(--status-success, 152 69% 53%));
  --zk-warning: hsl(var(--status-warning, 38 92% 60%));
  --zk-danger: hsl(var(--status-danger, 0 84% 64%));
  --zk-info: hsl(var(--status-info, 213 94% 68%));
  --zk-shadow-sm: 0 1px 3px hsl(0 0% 0% / .25);
  --zk-shadow-md: 0 6px 16px -2px hsl(0 0% 0% / .38);
  --zk-shadow-lg: 0 20px 44px -8px hsl(0 0% 0% / .58);
}
@media (max-width: 767px) {
  .zk-root, .zhin-console-surface {
    --zk-text-body: var(--console-text-body, 13px); --zk-text-small: var(--console-text-label, 12px);
    --zk-text-title: var(--console-text-title, 22px); --zk-control: var(--console-control-height, 42px);
    --zk-control-sm: var(--console-control-height-sm, 38px);
    --zk-radius-sm: var(--console-radius-sm, 6px); --zk-radius-md: var(--console-radius-md, 8px); --zk-radius-lg: var(--console-radius-lg, 12px);
  }
}
@media (min-width: 768px) and (max-width: 1199px) {
  .zk-root, .zhin-console-surface { --zk-text-title: var(--console-text-title, 24px); --zk-control-sm: var(--console-control-height-sm, 34px); }
}
.zk-root :where(h1, h2, h3, h4, p, ul, ol, dl, pre, figure, blockquote) { margin: 0; }
.zk-root :where(ul, ol) { list-style: none; padding: 0; }
.zk-root :where(dd) { margin: 0; }
.zk-root :where(button, input, select, textarea) { font: inherit; }
.zk-root :where(a) { color: var(--zk-primary); text-underline-offset: 3px; overflow-wrap: anywhere; }
.zk-root :where(button, a, input, select, textarea, summary, [tabindex]):focus-visible { outline: var(--zk-focus) solid var(--zk-ring); outline-offset: 2px; }
.zk-root :where(input:not([type="checkbox"]):not([type="radio"]), select, textarea) {
  width: 100%; min-width: 0; min-height: var(--zk-control); padding: 6px 12px; box-sizing: border-box;
  border: 1px solid var(--zk-input-line); border-radius: var(--zk-radius-md); background: var(--zk-surface); color: var(--zk-fg);
  transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease;
}
.zk-root :where(input:not([type="checkbox"]):not([type="radio"]), select, textarea):focus {
  border-color: var(--zk-primary);
  box-shadow: 0 0 0 3px hsl(var(--primary, 173 80% 36%) / .12);
}
.zk-root :where(input, textarea)::placeholder { color: var(--zk-muted); }
.zk-root :where(input, select, textarea):disabled { opacity: .58; cursor: not-allowed; }
.zk-root :where(input, select, textarea)[aria-invalid="true"] { border-color: var(--zk-danger); }

/* ── Page & Layout Primitives ── */
.zk-page { max-width: 1180px; margin: 0 auto; padding: 28px 28px 48px; display: grid; gap: 24px; }
.zk-page-header {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  padding-bottom: 18px; border-bottom: 1px solid var(--zk-line);
}
.zk-page-header__identity { display: flex; align-items: center; gap: 14px; min-width: 0; }
.zk-page-header h1 { font-size: var(--zk-text-title); line-height: 1.25; font-weight: 700; letter-spacing: -0.015em; overflow-wrap: anywhere; }
.zk-page-header p { margin-top: 4px; color: var(--zk-muted); max-width: 68ch; font-size: var(--zk-text-small); }
.zk-mark {
  display: grid; place-items: center; width: 46px; height: 46px; flex-shrink: 0;
  border-radius: var(--zk-radius-lg);
  background: linear-gradient(135deg, hsl(var(--primary, 172 66% 50%) / .18), var(--zk-inset));
  border: 1px solid hsl(var(--primary, 172 66% 50%) / .28);
  color: var(--zk-primary); font-weight: 700; font-size: 18px;
  box-shadow: var(--zk-shadow-sm);
}
.zk-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.zk-stack { display: grid; gap: 12px; min-width: 0; }
.zk-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--zk-grid-min, 240px), 1fr)); gap: var(--zk-grid-gap, 16px); min-width: 0; }
.zk-grow { flex-grow: 1; }
.zk-divider { border: 0; border-top: 1px solid var(--zk-line); margin: 4px 0; width: 100%; }
.zk-divider--dashed { border-top-style: dashed; }
.zk-divider-label { display: flex; align-items: center; gap: 12px; color: var(--zk-muted); font-size: var(--zk-text-xs); font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; }
.zk-divider-label::before, .zk-divider-label::after { content: ''; flex: 1; border-top: 1px solid var(--zk-line); }
.zk-section { min-width: 0; scroll-margin-top: 24px; display: grid; gap: 12px; align-content: start; }
.zk-section__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.zk-section h2 { font-size: var(--zk-text-section); font-weight: 650; letter-spacing: -0.01em; }
.zk-hint { font-size: var(--zk-text-small); color: var(--zk-muted); }

/* ── Card Surface ── */
.zk-card {
  padding: 18px; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg);
  background: var(--zk-surface); display: grid; gap: 14px; min-width: 0;
  box-shadow: var(--zk-shadow-sm);
  transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease;
}
.zk-card:hover { border-color: var(--zk-input-line); }
.zk-card--interactive { cursor: pointer; }
.zk-card--interactive:hover { transform: translateY(-1px); box-shadow: var(--zk-shadow-md); border-color: var(--zk-primary); }
.zk-card--compact { padding: 12px 14px; gap: 10px; }
.zk-card--primary { border-color: hsl(var(--primary, 173 80% 36%) / .35); }
.zk-card--success { border-color: hsl(var(--status-success, 152 60% 32%) / .35); }
.zk-card--warning { border-color: hsl(var(--status-warning, 35 88% 36%) / .38); }
.zk-card--danger { border-color: hsl(var(--status-danger, 0 72% 46%) / .38); }
.zk-card__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.zk-card__title-group { display: grid; gap: 2px; min-width: 0; }
.zk-card__title { font-size: 15px; font-weight: 650; line-height: 1.35; color: var(--zk-fg); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.zk-card__subtitle { font-size: var(--zk-text-xs); color: var(--zk-muted); }
.zk-card__footer { padding-top: 12px; border-top: 1px solid var(--zk-line); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }

/* ── Lists & Key-Value Description Grids ── */
.zk-list { display: grid; gap: 12px; }
.zk-dl { display: grid; grid-template-columns: minmax(110px, 220px) minmax(0, 1fr); gap: 0 16px; font-size: var(--zk-text-small); }
.zk-dl dt, .zk-dl dd { padding: 8px 0; border-bottom: 1px dashed var(--zk-line); display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.zk-dl dt:last-of-type, .zk-dl dd:last-of-type { border-bottom: none; }
.zk-dl dt { color: var(--zk-muted); font-weight: 500; overflow-wrap: anywhere; }
.zk-dl dd { overflow-wrap: anywhere; font-weight: 500; }
.zk-kv-grid { display: grid; grid-template-columns: repeat(var(--zk-kv-cols, 2), minmax(0, 1fr)); gap: 12px 20px; }
.zk-kv-item { display: grid; gap: 4px; padding: 10px 12px; border-radius: var(--zk-radius-md); background: var(--zk-inset); border: 1px solid transparent; min-width: 0; }
.zk-kv-grid--bordered .zk-kv-item { background: var(--zk-surface); border-color: var(--zk-line); }
.zk-kv-item__label { font-size: var(--zk-text-xs); color: var(--zk-muted); font-weight: 500; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.zk-kv-item__value { font-size: var(--zk-text-body); font-weight: 600; overflow-wrap: anywhere; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* ── Navigation, Tabs & SegmentedControl ── */
.zk-nav { display: flex; flex-wrap: wrap; gap: 8px 20px; border-bottom: 1px solid var(--zk-line); }
.zk-nav a { display: inline-flex; align-items: center; gap: 6px; min-height: var(--zk-control-sm); color: var(--zk-fg); text-decoration: none; font-weight: 600; }
.zk-nav a:hover { text-decoration: underline; }
.zk-tabs { display: grid; gap: 16px; min-width: 0; }
.zk-tablist { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--zk-line); }
.zk-tablist--pills { border-bottom: none; gap: 6px; }
.zk-tablist--segmented { border-bottom: none; background: var(--zk-inset); padding: 4px; border-radius: var(--zk-radius-md); width: fit-content; max-width: 100%; border: 1px solid var(--zk-line); }
.zk-tab {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: var(--zk-control-sm); padding: 6px 14px; border: 0; background: transparent;
  color: var(--zk-muted); font-size: var(--zk-text-small); font-weight: 600; cursor: pointer;
  border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .14s, background-color .14s, border-color .14s;
  white-space: nowrap;
}
.zk-tab:hover:not(:disabled) { color: var(--zk-fg); }
.zk-tab[aria-selected="true"] { color: var(--zk-primary); border-bottom-color: var(--zk-primary); }
.zk-tablist--pills .zk-tab { border-bottom: 0; margin-bottom: 0; border-radius: var(--zk-radius-md); border: 1px solid transparent; }
.zk-tablist--pills .zk-tab[aria-selected="true"] { background: hsl(var(--primary, 173 80% 36%) / .12); border-color: hsl(var(--primary, 173 80% 36%) / .28); color: var(--zk-primary); }
.zk-tablist--segmented .zk-tab { border-bottom: 0; margin-bottom: 0; border-radius: var(--zk-radius-sm); padding: 4px 12px; min-height: calc(var(--zk-control-sm) - 4px); }
.zk-tablist--segmented .zk-tab[aria-selected="true"] { background: var(--zk-elevated); color: var(--zk-fg); box-shadow: var(--zk-shadow-sm); }
.zk-tab:disabled { opacity: .45; cursor: not-allowed; }
.zk-tabpanel { min-width: 0; }

/* ── Collapsible / Accordion ── */
.zk-collapsible { border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg); background: var(--zk-surface); overflow: hidden; }
.zk-collapsible__trigger {
  width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 13px 16px; border: 0; background: transparent; color: var(--zk-fg);
  font-size: var(--zk-text-body); font-weight: 600; cursor: pointer; text-align: left;
  transition: background-color .14s ease;
}
.zk-collapsible__trigger:hover { background: var(--zk-inset); }
.zk-collapsible__chevron { display: inline-flex; transition: transform .18s ease; color: var(--zk-muted); flex-shrink: 0; }
.zk-collapsible[data-open="true"] .zk-collapsible__chevron { transform: rotate(90deg); }
.zk-collapsible__body { padding: 14px 16px 16px; border-top: 1px solid var(--zk-line); display: grid; gap: 12px; }

/* ── Buttons, Badges, Tags & Kbd ── */
.zk-count { font-size: var(--zk-text-xs); background: var(--zk-inset); padding: 1px 8px; border-radius: 999px; color: var(--zk-muted); font-variant-numeric: tabular-nums; font-weight: 600; }
.zk-footnote { color: var(--zk-muted); font-size: var(--zk-text-small); }
.zk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: var(--zk-control); padding: 0 14px; box-sizing: border-box;
  border: 1px solid var(--zk-line); border-radius: var(--zk-radius-md); background: var(--zk-surface); color: var(--zk-fg);
  font-size: var(--zk-text-small); font-weight: 600; cursor: pointer; white-space: nowrap; text-decoration: none; transition: background-color .14s, border-color .14s, transform .1s, box-shadow .14s; }
.zk-btn:hover:not(:disabled) { background: var(--zk-inset); border-color: var(--zk-input-line); }
.zk-btn:active:not(:disabled) { transform: translateY(0.5px); }
.zk-btn--primary { background: var(--zk-primary); border-color: var(--zk-primary); color: var(--zk-on-primary); box-shadow: 0 1px 2px hsl(var(--primary, 173 80% 36%) / .25); }
.zk-btn--primary:hover:not(:disabled) { background: var(--zk-primary); border-color: var(--zk-primary); filter: brightness(.93); }
.zk-btn--ghost { border-color: transparent; background: transparent; }
.zk-btn--danger { background: hsl(var(--destructive, 0 68% 42%)); border-color: hsl(var(--destructive, 0 68% 42%)); color: hsl(var(--destructive-foreground, 0 0% 100%)); }
.zk-btn--danger:hover:not(:disabled) { background: hsl(var(--destructive, 0 68% 42%)); filter: brightness(.92); }
.zk-btn--sm { min-height: var(--zk-control-sm); padding: 0 10px; font-size: 12px; }
.zk-btn--lg { min-height: var(--zk-control-lg); padding: 0 18px; font-size: 14.5px; border-radius: var(--zk-radius-lg); }
.zk-btn--icon { min-height: var(--zk-control-sm); min-width: var(--zk-control-sm); padding: 0; }
.zk-btn--success { background: var(--zk-success); border-color: var(--zk-success); color: #ffffff; }
.zk-btn--warning { background: var(--zk-warning); border-color: var(--zk-warning); color: #ffffff; }
.zk-btn:disabled { cursor: not-allowed; opacity: .5; }
.zk-btn[aria-busy="true"] { opacity: 1; cursor: progress; }
.zk-spinner { width: 14px; height: 14px; flex-shrink: 0; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: zk-spin .8s linear infinite; }
@keyframes zk-spin { to { transform: rotate(360deg); } }

.zk-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 1.5; white-space: nowrap; background: var(--zk-inset); color: var(--zk-muted); border: 1px solid transparent; }
.zk-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.zk-badge--has-icon::before { display: none; }
.zk-badge--sm { padding: 1px 7px; font-size: 11px; gap: 4px; }
.zk-badge--lg { padding: 3px 11px; font-size: 13px; gap: 7px; }
.zk-badge--primary { background: hsl(var(--primary, 173 80% 36%) / .14); color: var(--zk-primary); border-color: hsl(var(--primary, 173 80% 36%) / .28); }
.zk-badge--success { background: hsl(var(--status-success, 152 60% 32%) / .14); color: var(--zk-success); border-color: hsl(var(--status-success, 152 60% 32%) / .25); }
.zk-badge--warning { background: hsl(var(--status-warning, 35 88% 36%) / .15); color: var(--zk-warning); border-color: hsl(var(--status-warning, 35 88% 36%) / .25); }
.zk-badge--danger { background: hsl(var(--status-danger, 0 72% 46%) / .14); color: var(--zk-danger); border-color: hsl(var(--status-danger, 0 72% 46%) / .25); }
.zk-badge--info { background: hsl(var(--status-info, 217 78% 52%) / .14); color: var(--zk-info); border-color: hsl(var(--status-info, 217 78% 52%) / .25); }

.zk-tag { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: var(--zk-radius-xs); font-size: 12px; font-weight: 500; background: var(--zk-inset); color: var(--zk-fg); border: 1px solid var(--zk-line); line-height: 1.4; }
.zk-tag--sm { padding: 1px 6px; font-size: 11px; }
.zk-tag--lg { padding: 3px 10px; font-size: 13px; }
.zk-tag--mono { font-family: var(--zk-font-mono); font-size: 11.5px; }
.zk-tag--primary { background: hsl(var(--primary, 173 80% 36%) / .12); color: var(--zk-primary); border-color: hsl(var(--primary, 173 80% 36%) / .28); }
.zk-tag--success { background: hsl(var(--status-success, 152 60% 32%) / .12); color: var(--zk-success); border-color: hsl(var(--status-success, 152 60% 32%) / .25); }
.zk-tag--warning { background: hsl(var(--status-warning, 35 88% 36%) / .14); color: var(--zk-warning); border-color: hsl(var(--status-warning, 35 88% 36%) / .25); }
.zk-tag--danger { background: hsl(var(--status-danger, 0 72% 46%) / .12); color: var(--zk-danger); border-color: hsl(var(--status-danger, 0 72% 46%) / .25); }
.zk-tag--info { background: hsl(var(--status-info, 217 78% 52%) / .12); color: var(--zk-info); border-color: hsl(var(--status-info, 217 78% 52%) / .25); }
.zk-tag__remove { border: 0; background: transparent; color: currentColor; opacity: .65; cursor: pointer; padding: 0 2px; font-size: 13px; line-height: 1; border-radius: 3px; }
.zk-tag__remove:hover { opacity: 1; background: hsl(0 0% 0% / .08); }

.zk-kbd { display: inline-flex; align-items: center; gap: 2px; padding: 1px 6px; border-radius: 5px; font-family: var(--zk-font-mono); font-size: 11px; font-weight: 600; color: var(--zk-muted); background: var(--zk-elevated); border: 1px solid var(--zk-line); box-shadow: 0 1px 0 var(--zk-line); line-height: 1.4; }

/* ── StatusDot & Avatar ── */
.zk-status-dot { display: inline-flex; align-items: center; gap: 6px; font-size: var(--zk-text-small); font-weight: 500; }
.zk-status-dot__indicator { width: 8px; height: 8px; border-radius: 50%; background: var(--zk-muted); flex-shrink: 0; position: relative; }
.zk-status-dot--success .zk-status-dot__indicator { background: var(--zk-success); }
.zk-status-dot--warning .zk-status-dot__indicator { background: var(--zk-warning); }
.zk-status-dot--danger .zk-status-dot__indicator { background: var(--zk-danger); }
.zk-status-dot--info .zk-status-dot__indicator { background: var(--zk-info); }
.zk-status-dot--pulse .zk-status-dot__indicator::after {
  content: ''; position: absolute; inset: -3px; border-radius: 50%; border: 2px solid currentColor; opacity: .45;
  animation: zk-ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite;
}
@keyframes zk-ping { 75%, 100% { transform: scale(1.65); opacity: 0; } }

.zk-avatar {
  position: relative; display: inline-grid; place-items: center; width: 36px; height: 36px; flex-shrink: 0;
  border-radius: 50%; background: linear-gradient(135deg, hsl(var(--primary, 173 80% 36%) / .2), var(--zk-inset));
  border: 1px solid var(--zk-line); color: var(--zk-primary); font-weight: 700; font-size: 14px; user-select: none; overflow: visible;
}
.zk-avatar--sm { width: 28px; height: 28px; font-size: 12px; }
.zk-avatar--lg { width: 48px; height: 48px; font-size: 18px; }
.zk-avatar--rounded { border-radius: var(--zk-radius-md); }
.zk-avatar__img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
.zk-avatar__status { position: absolute; right: -1px; bottom: -1px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--zk-elevated); background: var(--zk-muted); }
.zk-avatar__status--online { background: var(--zk-success); }
.zk-avatar__status--busy { background: var(--zk-danger); }
.zk-avatar__status--warning { background: var(--zk-warning); }

/* ── Form Controls (Input, Select, Switch, Checkbox, RadioGroup) ── */
.zk-field { display: grid; gap: 6px; min-width: 0; }
.zk-field__label { font-size: var(--zk-text-small); font-weight: 600; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.zk-field__required { color: var(--zk-danger); }
.zk-field__error { font-size: var(--zk-text-small); color: var(--zk-danger); }
.zk-input-wrap { position: relative; display: flex; align-items: center; width: 100%; min-width: 0; }
.zk-input-wrap__prefix, .zk-input-wrap__suffix { display: inline-flex; align-items: center; color: var(--zk-muted); font-size: var(--zk-text-small); pointer-events: none; position: absolute; top: 50%; transform: translateY(-50%); }
.zk-input-wrap__prefix { left: 11px; }
.zk-input-wrap__suffix { right: 10px; pointer-events: auto; }
.zk-input-wrap--has-prefix input { padding-left: 34px; }
.zk-input-wrap--has-suffix input { padding-right: 34px; }
.zk-input--mono { font-family: var(--zk-font-mono); font-size: 12.5px; }
.zk-input--sm { min-height: var(--zk-control-sm) !important; padding: 3px 10px !important; font-size: 12.5px !important; }
.zk-input--lg { min-height: var(--zk-control-lg) !important; padding: 8px 14px !important; font-size: 14.5px !important; }

.zk-switch-row { display: inline-flex; align-items: flex-start; gap: 10px; cursor: pointer; user-select: none; }
.zk-switch-row[aria-disabled="true"] { opacity: .55; cursor: not-allowed; }
.zk-switch {
  position: relative; width: 38px; height: 22px; border-radius: 999px; flex-shrink: 0;
  border: 1px solid var(--zk-input-line); background: var(--zk-inset); cursor: inherit; padding: 0;
  transition: background-color .16s ease, border-color .16s ease;
}
.zk-switch--sm { width: 32px; height: 18px; }
.zk-switch--lg { width: 46px; height: 26px; }
.zk-switch[aria-checked="true"] { background: var(--zk-primary); border-color: var(--zk-primary); }
.zk-switch__thumb {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
  background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .16s cubic-bezier(.22,1,.36,1);
}
.zk-switch--sm .zk-switch__thumb { width: 12px; height: 12px; }
.zk-switch--lg .zk-switch__thumb { width: 20px; height: 20px; }
.zk-switch[aria-checked="true"] .zk-switch__thumb { transform: translateX(16px); }
.zk-switch--sm[aria-checked="true"] .zk-switch__thumb { transform: translateX(14px); }
.zk-switch--lg[aria-checked="true"] .zk-switch__thumb { transform: translateX(20px); }
.zk-control-text { display: grid; gap: 2px; min-width: 0; flex: 1; }
.zk-control-text__label { font-size: var(--zk-text-small); font-weight: 500; line-height: 1.4; color: var(--zk-fg); display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.zk-control-text__desc { font-size: var(--zk-text-xs); color: var(--zk-muted); line-height: 1.4; }
.zk-check-icon {
  display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: var(--zk-radius-xs);
  background: var(--zk-inset); color: var(--zk-primary); font-size: 13px; flex-shrink: 0; overflow: hidden;
}
.zk-check-icon img { width: 100%; height: 100%; object-fit: cover; display: block; }

.zk-check-row { display: inline-flex; align-items: flex-start; gap: 8px; cursor: pointer; user-select: none; min-width: 0; }
.zk-check-row[aria-disabled="true"] { opacity: .55; cursor: not-allowed; }
.zk-check-row input[type="checkbox"], .zk-check-row input[type="radio"] {
  width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--zk-primary); cursor: inherit; flex-shrink: 0;
}
.zk-check-card {
  display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px;
  border: 1px solid var(--zk-line); border-radius: var(--zk-radius-md); background: var(--zk-surface);
  transition: border-color .15s ease, background-color .15s ease, box-shadow .15s ease;
}
.zk-check-card:hover:not([aria-disabled="true"]) { border-color: var(--zk-input-line); background: var(--zk-inset); }
.zk-check-card[data-checked="true"] {
  border-color: var(--zk-primary); background: hsl(var(--primary, 173 80% 36%) / .08);
  box-shadow: 0 0 0 1px hsl(var(--primary, 173 80% 36%) / .22);
}
.zk-check-card .zk-check-icon { width: 30px; height: 30px; border-radius: var(--zk-radius-sm); font-size: 15px; }

.zk-radio-group, .zk-check-group { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.zk-radio-group--row, .zk-check-group--row { flex-direction: row; flex-wrap: wrap; gap: 12px 16px; }
.zk-radio-group--grid, .zk-check-group--grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--zk-choice-min, 190px), 1fr)); gap: 10px;
}
.zk-radio-group--button {
  flex-direction: row; flex-wrap: wrap; gap: 6px;
}
.zk-radio-btn {
  display: inline-flex; align-items: center; gap: 7px; min-height: var(--zk-control-sm); padding: 5px 13px;
  border: 1px solid var(--zk-line); border-radius: var(--zk-radius-md); background: var(--zk-surface);
  color: var(--zk-fg); font-size: var(--zk-text-small); font-weight: 500; cursor: pointer; user-select: none;
  transition: border-color .14s ease, background-color .14s ease, color .14s ease;
}
.zk-radio-btn input[type="radio"] { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.zk-radio-btn:hover:not([aria-disabled="true"]) { border-color: var(--zk-input-line); background: var(--zk-inset); }
.zk-radio-btn[data-checked="true"] {
  border-color: var(--zk-primary); background: hsl(var(--primary, 173 80% 36%) / .12); color: var(--zk-primary); font-weight: 600;
}
.zk-radio-btn[aria-disabled="true"] { opacity: .5; cursor: not-allowed; }

/* ── ProgressBar, RingProgress, Sparkline, BarChart & DonutChart ── */
.zk-progress-wrap { display: grid; gap: 5px; width: 100%; min-width: 0; }
.zk-progress-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: var(--zk-text-xs); color: var(--zk-muted); font-variant-numeric: tabular-nums; }
.zk-progress { width: 100%; height: 8px; border-radius: 999px; background: var(--zk-inset); overflow: hidden; border: 1px solid var(--zk-line); }
.zk-progress--sm { height: 5px; }
.zk-progress--lg { height: 12px; }
.zk-progress__bar { height: 100%; border-radius: inherit; background: var(--zk-primary); transition: width .25s ease; }
.zk-progress--success .zk-progress__bar { background: var(--zk-success); }
.zk-progress--warning .zk-progress__bar { background: var(--zk-warning); }
.zk-progress--danger .zk-progress__bar { background: var(--zk-danger); }
.zk-progress--info .zk-progress__bar { background: var(--zk-info); }
.zk-progress--striped .zk-progress__bar {
  background-image: linear-gradient(45deg, rgba(255,255,255,.18) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.18) 50%, rgba(255,255,255,.18) 75%, transparent 75%, transparent);
  background-size: 16px 16px;
}

.zk-ring-progress { display: inline-flex; align-items: center; gap: 12px; }
.zk-ring-progress__svg-wrap { position: relative; display: inline-grid; place-items: center; flex-shrink: 0; }
.zk-ring-progress__center { position: absolute; inset: 0; display: grid; place-items: center; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; pointer-events: none; }
.zk-ring-progress__img { width: 58%; height: 58%; border-radius: 50%; object-fit: cover; display: block; border: 1px solid var(--zk-line); background: var(--zk-elevated); }
.zk-ring-progress__meta { display: grid; gap: 2px; min-width: 0; }

.zk-stat-watermark {
  position: absolute; right: 10px; bottom: 8px; pointer-events: none; opacity: .09;
  width: 64px; height: 64px; display: grid; place-items: center; overflow: hidden; user-select: none;
}
.zk-stat-watermark img { width: 100%; height: 100%; object-fit: contain; display: block; }
.zk-stat-icon-img { width: 22px; height: 22px; border-radius: var(--zk-radius-xs); object-fit: cover; display: block; }

.zk-bar-chart {
  position: relative; display: grid; gap: 10px; padding: 14px; border: 1px solid var(--zk-line);
  border-radius: var(--zk-radius-lg); background: var(--zk-surface); overflow: hidden; min-width: 0;
}
.zk-bar-chart__bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .07; pointer-events: none; }
.zk-bar-chart__bars { position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(38px, 1fr); align-items: end; gap: 10px; padding-top: 8px; overflow-x: auto; }
.zk-bar-chart__col { display: grid; justify-items: center; gap: 6px; min-width: 0; }
.zk-bar-chart__val { font-size: 11px; font-weight: 600; color: var(--zk-muted); font-variant-numeric: tabular-nums; }
.zk-bar-chart__track { width: 100%; max-width: 38px; border-radius: var(--zk-radius-xs) var(--zk-radius-xs) 3px 3px; background: var(--zk-inset); display: flex; align-items: flex-end; overflow: hidden; }
.zk-bar-chart__bar { width: 100%; border-radius: inherit; background: var(--zk-primary); transition: height .25s ease; min-height: 4px; }
.zk-bar-chart__bar--success { background: var(--zk-success); }
.zk-bar-chart__bar--warning { background: var(--zk-warning); }
.zk-bar-chart__bar--danger { background: var(--zk-danger); }
.zk-bar-chart__bar--info { background: var(--zk-info); }
.zk-bar-chart__img { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; border: 1px solid var(--zk-line); background: var(--zk-elevated); }
.zk-bar-chart__label { font-size: 11.5px; color: var(--zk-muted); text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }

.zk-donut-chart { display: flex; align-items: center; flex-wrap: wrap; gap: 18px; min-width: 0; }
.zk-donut-chart__legend { display: grid; gap: 6px; flex: 1; min-width: 160px; }
.zk-donut-chart__item { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: var(--zk-text-small); }
.zk-donut-chart__item-label { display: inline-flex; align-items: center; gap: 7px; min-width: 0; color: var(--zk-fg); font-weight: 500; }
.zk-donut-chart__swatch { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.zk-donut-chart__item-img { width: 16px; height: 16px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.zk-donut-chart__item-val { font-variant-numeric: tabular-nums; color: var(--zk-muted); font-size: var(--zk-text-xs); font-weight: 600; }

/* ── Timeline ── */
.zk-timeline { display: grid; gap: 0; position: relative; padding-left: 4px; }
.zk-timeline-item { position: relative; display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; padding-bottom: 18px; }
.zk-timeline-item:last-child { padding-bottom: 0; }
.zk-timeline-item__rail { display: flex; flex-direction: column; align-items: center; position: relative; }
.zk-timeline-item__dot {
  width: 10px; height: 10px; border-radius: 50%; margin-top: 5px; flex-shrink: 0;
  background: var(--zk-primary); box-shadow: 0 0 0 3px hsl(var(--primary, 173 80% 36%) / .16);
}
.zk-timeline-item--success .zk-timeline-item__dot { background: var(--zk-success); box-shadow: 0 0 0 3px hsl(var(--status-success, 152 60% 32%) / .16); }
.zk-timeline-item--warning .zk-timeline-item__dot { background: var(--zk-warning); box-shadow: 0 0 0 3px hsl(var(--status-warning, 35 88% 36%) / .18); }
.zk-timeline-item--danger .zk-timeline-item__dot { background: var(--zk-danger); box-shadow: 0 0 0 3px hsl(var(--status-danger, 0 72% 46%) / .16); }
.zk-timeline-item--neutral .zk-timeline-item__dot { background: var(--zk-muted); box-shadow: none; }
.zk-timeline-item__line { flex: 1; width: 2px; background: var(--zk-line); margin-top: 4px; margin-bottom: -4px; }
.zk-timeline-item:last-child .zk-timeline-item__line { display: none; }
.zk-timeline-item__body { display: grid; gap: 4px; min-width: 0; }
.zk-timeline-item__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.zk-timeline-item__title { font-weight: 600; font-size: var(--zk-text-body); color: var(--zk-fg); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.zk-timeline-item__time { font-size: var(--zk-text-xs); color: var(--zk-muted); font-variant-numeric: tabular-nums; }
.zk-timeline-item__desc { font-size: var(--zk-text-small); color: var(--zk-muted); }

/* ── CodeBlock & JsonView ── */
.zk-code-block { border: 1px solid var(--zk-line); border-radius: var(--zk-radius-md); background: var(--zk-inset); overflow: hidden; display: grid; min-width: 0; }
.zk-code-block__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--zk-line); background: var(--zk-surface); font-size: var(--zk-text-xs); color: var(--zk-muted); }
.zk-code-block__pre { margin: 0; padding: 12px 14px; font-family: var(--zk-font-mono); font-size: 12.5px; line-height: 1.55; overflow-x: auto; white-space: pre; color: var(--zk-fg); }

/* ── Notices, Empty, Loading, Error & Skeleton ── */
.zk-notice { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 16px; border: 1px solid var(--zk-line); border-left-width: 4px; border-radius: var(--zk-radius-md); background: var(--zk-surface); overflow-wrap: anywhere; }
.zk-notice__body { display: grid; gap: 4px; min-width: 0; }
.zk-notice__title { font-weight: 650; }
.zk-notice--info { border-left-color: var(--zk-info); }
.zk-notice--success { border-left-color: var(--zk-success); }
.zk-notice--warning { border-left-color: var(--zk-warning); }
.zk-notice--danger { border-left-color: var(--zk-danger); }
.zk-empty { display: grid; justify-items: center; gap: 6px; text-align: center; padding: 36px 20px; border: 1px dashed var(--zk-line); border-radius: var(--zk-radius-lg); background: var(--zk-surface); color: var(--zk-muted); }
.zk-empty strong { color: var(--zk-fg); font-size: var(--zk-text-section); }
.zk-empty p { max-width: 48ch; }
.zk-empty__icon { display: inline-flex; color: var(--zk-primary); }
.zk-loading { display: grid; gap: 10px; }
.zk-loading p { color: var(--zk-muted); }
.zk-loading__block, .zk-skeleton { display: block; height: 72px; border-radius: var(--zk-radius-lg); background: var(--zk-inset); animation: zk-pulse 1.6s ease-in-out infinite; }
.zk-skeleton--text { height: 14px; border-radius: var(--zk-radius-xs); }
.zk-skeleton--circle { border-radius: 50%; }
@keyframes zk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
.zk-error { display: grid; gap: 8px; justify-items: start; padding: 16px; border: 1px solid var(--zk-danger); border-radius: var(--zk-radius-lg); background: hsl(var(--status-danger, 0 68% 42%) / .06); }
.zk-error p { max-width: 70ch; }
.zk-error details { font-size: var(--zk-text-small); color: var(--zk-muted); max-width: 100%; }
.zk-error summary { cursor: pointer; min-height: var(--zk-control-sm); display: flex; align-items: center; }
.zk-error pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.zk-confirm { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 6px 10px; border: 1px solid var(--zk-danger); border-radius: var(--zk-radius-md); background: hsl(var(--status-danger, 0 68% 42%) / .08); }
.zk-confirm__message { font-size: var(--zk-text-small); overflow-wrap: anywhere; max-width: 36ch; }

/* ── Modal, Drawer & Tooltip ── */
.zk-overlay-backdrop {
  position: fixed; inset: 0; z-index: 999; background: rgba(15, 23, 42, .48); backdrop-filter: blur(3px);
  display: grid; place-items: center; padding: 16px; box-sizing: border-box;
}
.zk-modal {
  width: 100%; max-width: 520px; max-height: calc(100vh - 32px); overflow-y: auto;
  background: var(--zk-elevated); color: var(--zk-fg); border: 1px solid var(--zk-line);
  border-radius: var(--zk-radius-xl); box-shadow: var(--zk-shadow-lg); display: grid; gap: 16px; padding: 22px; box-sizing: border-box;
}
.zk-modal--sm { max-width: 380px; }
.zk-modal--lg { max-width: 740px; }
.zk-modal__head, .zk-drawer__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.zk-modal__title, .zk-drawer__title { font-size: 18px; font-weight: 700; line-height: 1.3; }
.zk-modal__desc, .zk-drawer__desc { font-size: var(--zk-text-small); color: var(--zk-muted); margin-top: 4px; }
.zk-modal__body, .zk-drawer__body { display: grid; gap: 14px; min-width: 0; }
.zk-modal__footer, .zk-drawer__footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--zk-line); }

.zk-drawer-backdrop {
  position: fixed; inset: 0; z-index: 999; background: rgba(15, 23, 42, .45); backdrop-filter: blur(2px);
  display: flex; justify-content: flex-end;
}
.zk-drawer-backdrop--left { justify-content: flex-start; }
.zk-drawer {
  width: min(460px, 100vw); height: 100%; overflow-y: auto;
  background: var(--zk-elevated); color: var(--zk-fg); border-left: 1px solid var(--zk-line);
  box-shadow: var(--zk-shadow-lg); display: flex; flex-direction: column; justify-content: space-between; gap: 16px; padding: 22px; box-sizing: border-box;
}
.zk-drawer-backdrop--left .zk-drawer { border-left: 0; border-right: 1px solid var(--zk-line); }

.zk-tooltip-wrap { position: relative; display: inline-flex; align-items: center; }
.zk-tooltip {
  position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
  padding: 4px 9px; border-radius: var(--zk-radius-xs); background: var(--zk-fg); color: var(--zk-elevated);
  font-size: 11.5px; font-weight: 500; white-space: nowrap; pointer-events: none; opacity: 0;
  transition: opacity .14s ease; z-index: 50; box-shadow: var(--zk-shadow-sm);
}
.zk-tooltip--bottom { bottom: auto; top: calc(100% + 6px); }
.zk-tooltip-wrap:hover .zk-tooltip, .zk-tooltip-wrap:focus-within .zk-tooltip { opacity: 1; }

/* ── DataTable, Fixed Columns, Batch Action Bar & Expandable Rows ── */
.zk-table-wrap { position: relative; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg); overflow-x: auto; background: var(--zk-surface); }
.zk-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: var(--zk-text-small); }
.zk-cell-fixed-left, .zk-cell-fixed-right {
  position: sticky; z-index: 2; background: var(--zk-elevated) !important;
}
th.zk-cell-fixed-left, th.zk-cell-fixed-right {
  z-index: 3; background: var(--zk-elevated) !important;
}
.zk-cell-fixed-left-last {
  box-shadow: 4px 0 8px -4px rgba(15, 23, 42, .12);
  border-right: 1px solid var(--zk-line);
}
.zk-cell-fixed-right-first {
  box-shadow: -4px 0 8px -4px rgba(15, 23, 42, .12);
  border-left: 1px solid var(--zk-line);
}
html.dark .zk-cell-fixed-left-last, .dark .zk-cell-fixed-left-last { box-shadow: 5px 0 10px -4px rgba(0, 0, 0, .42); }
html.dark .zk-cell-fixed-right-first, .dark .zk-cell-fixed-right-first { box-shadow: -5px 0 10px -4px rgba(0, 0, 0, .42); }
.zk-row-selected td { background: hsl(var(--primary, 173 80% 36%) / .07) !important; }
.zk-row-selected td.zk-cell-fixed-left, .zk-row-selected td.zk-cell-fixed-right {
  background: var(--zk-elevated) !important;
}
.zk-batch-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 9px 14px; border-radius: var(--zk-radius-md);
  border: 1px solid hsl(var(--primary, 173 80% 36%) / .34);
  background: linear-gradient(90deg, hsl(var(--primary, 173 80% 36%) / .11), var(--zk-surface));
  box-shadow: var(--zk-shadow-sm);
}
.zk-batch-bar__info { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: var(--zk-text-small); font-weight: 600; color: var(--zk-fg); }
.zk-batch-bar__actions { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.zk-table-expand-btn {
  display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: var(--zk-radius-xs);
  border: 1px solid var(--zk-line); background: var(--zk-surface); color: var(--zk-muted); cursor: pointer; padding: 0;
  transition: transform .15s ease, color .15s ease, border-color .15s ease;
}
.zk-table-expand-btn:hover { color: var(--zk-fg); border-color: var(--zk-input-line); }
.zk-table-expand-btn[aria-expanded="true"] { transform: rotate(90deg); color: var(--zk-primary); border-color: var(--zk-primary); }
.zk-table-expanded-row td { background: var(--zk-inset); padding: 12px 16px; border-bottom: 1px solid var(--zk-line); }

/* ── Media, Split & Multi-Breakpoint Responsive Adaptation ── */
.zk-qr { display: block; width: 176px; max-width: 100%; height: auto; padding: 10px; box-sizing: border-box; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-md);
  background: hsl(0 0% 100%); }
.zk-media { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 20px; }
.zk-media__body { display: grid; gap: 12px; flex: 1; min-width: min(240px, 100%); }
.zk-split { display: grid; grid-template-columns: minmax(0, 1fr) var(--zk-sidebar-w, 300px); gap: 24px; align-items: start; }
.zk-split--single { grid-template-columns: minmax(0, 1fr); }
.zk-account__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.zk-account__head strong { font-size: var(--zk-text-section); overflow-wrap: anywhere; }
.zk-card details { font-size: var(--zk-text-small); }
.zk-card summary { cursor: pointer; width: fit-content; min-height: var(--zk-control-sm); display: flex; align-items: center; color: var(--zk-muted); }
.zk-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 959px) {
  .zk-split { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 767px) {
  .zk-page { padding: 18px 14px 32px; gap: 18px; }
  .zk-page-header { gap: 12px; padding-bottom: 14px; }
  .zk-btn--icon { min-width: 40px; min-height: 40px; }
  .zk-dl { grid-template-columns: minmax(80px, 1fr) minmax(0, 2fr); }
  .zk-kv-grid { grid-template-columns: minmax(0, 1fr); }
  .zk-tablist { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .zk-tablist::-webkit-scrollbar { display: none; }
  .zk-overlay-backdrop { align-items: end; padding: 0; }
  .zk-modal { max-width: 100%; border-radius: var(--zk-radius-xl) var(--zk-radius-xl) 0 0; max-height: 88vh; padding: 18px 16px 24px; }
  .zk-drawer { width: 100vw; padding: 18px 16px; }
  .zk-batch-bar { padding: 8px 12px; }
}
@media (max-width: 639px) {
  .zk-table--responsive thead { display: none; }
  .zk-table--responsive tbody, .zk-table--responsive tr, .zk-table--responsive td { display: block; width: 100% !important; box-sizing: border-box; }
  .zk-table--responsive tr { padding: 10px 12px; border-bottom: 1px solid var(--zk-line); }
  .zk-table--responsive td {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 6px 0 !important; border-bottom: none !important; text-align: right !important;
    position: static !important; box-shadow: none !important; border-left: none !important; border-right: none !important;
  }
  .zk-table--responsive td[data-label]::before {
    content: attr(data-label); font-weight: 600; color: var(--zk-muted); font-size: var(--zk-text-xs); text-align: left; flex-shrink: 0;
  }
  .zk-radio-group--grid, .zk-check-group--grid { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .zk-root *, .zk-root *::before, .zk-root *::after { transition: none !important; scroll-behavior: auto !important; }
  .zk-spinner, .zk-loading__block, .zk-skeleton, .zk-status-dot--pulse .zk-status-dot__indicator::after { animation: none; border-right-color: currentColor; border-style: dotted; }
}
`;
