import { pluginUiStyles } from '../ui/styles.js';

/**
 * 适配器页面与 Diana 风格多平台账号工作台样式（Master-Detail 账号卡片网格 ↔ 双栏配置工作台）。
 * 同时挂载在 `.zk-root`（`<PluginPage>` 根节点）与 `.zhin-console-surface` 下，
 * 颜色与圆角全部取自 `@zhin.js/client/ui` 的主题变量。
 */
const adapterStudioStyles = `
.zhin-console-surface :where(.flex.gap-2) { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.zhin-console-surface :where(.min-w-0) { min-width: 0; }
.zhin-console-surface :where(button, input, textarea, select) { font: inherit; }
.zhin-console-surface :where(button, a, input, textarea, select, summary):focus-visible { outline: var(--zk-focus) solid var(--zk-ring); outline-offset: 2px; }
.zhin-console-surface :where(input:not([type="checkbox"]), textarea, select) { width: 100%; min-width: 0; padding: 8px 12px; border: 1px solid var(--zk-input-line); border-radius: var(--zk-radius-md); background: transparent; color: var(--zk-fg); }
.zhin-console-surface :where(a) { color: var(--zk-primary); text-underline-offset: 3px; overflow-wrap: anywhere; }
.zhin-console-surface :where(h1,h2,h3,p,ul,dl) { margin: 0; }
.zhin-console-surface :where(ul) { list-style: none; padding: 0; }
.zhin-console-surface :where(dd) { margin: 0; }

/* ── Diana-Style Bot Profile Tile Grid (.bot-profile-grid) ── */
.zk-root .zk-bot-grid,
.zhin-console-surface .zk-bot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.zk-root .zk-bot-tile,
.zhin-console-surface .zk-bot-tile {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 0;
  min-height: 164px;
  border: 1px solid var(--zk-line);
  border-radius: var(--zk-radius-lg);
  background: var(--zk-elevated);
  box-shadow: var(--zk-shadow-sm);
  overflow: hidden;
  transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
}
.zk-root .zk-bot-tile:hover,
.zhin-console-surface .zk-bot-tile:hover {
  border-color: var(--zk-input-line);
  box-shadow: var(--zk-shadow-md);
}
.zk-root .zk-bot-tile__head,
.zhin-console-surface .zk-bot-tile__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 0;
}
.zk-root .zk-bot-tile__identity,
.zhin-console-surface .zk-bot-tile__identity {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
  flex: 1;
}
.zk-root .zk-bot-tile__icon,
.zhin-console-surface .zk-bot-tile__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  border-radius: 10px;
  background: var(--zk-primary-soft);
  color: var(--zk-primary);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.zk-root .zk-bot-tile__title-wrap,
.zhin-console-surface .zk-bot-tile__title-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.zk-root .zk-bot-tile__title,
.zhin-console-surface .zk-bot-tile__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.zk-root .zk-bot-tile__title strong,
.zhin-console-surface .zk-bot-tile__title strong {
  font-size: 15px;
  font-weight: 650;
  color: var(--zk-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zk-root .zk-bot-tile__subtitle,
.zhin-console-surface .zk-bot-tile__subtitle {
  font-size: 12px;
  color: var(--zk-muted);
  line-height: 1.35;
}
.zk-root .zk-bot-tile__head-right,
.zhin-console-surface .zk-bot-tile__head-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.zk-root .zk-bot-tile__head-right .zk-switch-row,
.zhin-console-surface .zk-bot-tile__head-right .zk-switch-row {
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--zk-muted);
  white-space: nowrap;
}
.zk-root .zk-account-editor-host,
.zhin-console-surface .zk-account-editor-host {
  display: grid;
  gap: 14px;
}
.zk-root .zk-account-pills,
.zhin-console-surface .zk-account-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.zk-root .zk-bot-tile > .zk-account-pills,
.zhin-console-surface .zk-bot-tile > .zk-account-pills {
  padding: 12px 18px 0;
}
.zk-root .zk-account-pill,
.zhin-console-surface .zk-account-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--zk-inset);
  color: var(--zk-muted);
  font-size: 11.5px;
  font-weight: 500;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zk-root .zk-bot-tile__config,
.zhin-console-surface .zk-bot-tile__config {
  font-size: 12px;
  margin: 8px 18px 0;
}
.zk-root .zk-bot-tile__config summary,
.zhin-console-surface .zk-bot-tile__config summary {
  cursor: pointer;
  color: var(--zk-muted);
  font-size: 11.5px;
  font-weight: 500;
  min-height: 22px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.zk-root .zk-bot-tile__config summary:hover,
.zhin-console-surface .zk-bot-tile__config summary:hover {
  color: var(--zk-fg);
}
.zk-root .zk-bot-tile__actions,
.zhin-console-surface .zk-bot-tile__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--zk-line);
  background: var(--zk-surface);
}
.zk-root .zk-bot-tile__actions .zk-btn,
.zhin-console-surface .zk-bot-tile__actions .zk-btn {
  min-height: 29px;
  padding: 0 11px;
  font-size: 12px;
  border-radius: 8px;
}
.zk-root .zk-bot-tile--add,
.zhin-console-surface .zk-bot-tile--add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 164px;
  height: 100%;
  padding: 20px;
  border: 1.5px dashed var(--zk-input-line);
  border-radius: var(--zk-radius-lg);
  background: transparent;
  color: var(--zk-muted);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease, background-color 150ms ease;
}
.zk-root .zk-bot-tile--add:hover:not(:disabled),
.zhin-console-surface .zk-bot-tile--add:hover:not(:disabled) {
  border-color: var(--zk-primary);
  background: var(--zk-primary-soft);
  color: var(--zk-primary);
}
.zk-root .zk-bot-tile--add__plus,
.zhin-console-surface .zk-bot-tile--add__plus {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--zk-inset);
  color: currentColor;
  font-size: 18px;
  font-weight: 500;
}

/* ── Master-Detail Editor View (.zk-editor-layout / Diana AssistantView edit mode) ── */
.zk-root .zk-editor-topbar,
.zhin-console-surface .zk-editor-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border: 1px solid var(--zk-line);
  border-radius: var(--zk-radius-lg);
  background: var(--zk-elevated);
  box-shadow: var(--zk-shadow-sm);
}
.zk-root .zk-editor-topbar__left,
.zhin-console-surface .zk-editor-topbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.zk-root .zk-editor-topbar__title,
.zhin-console-surface .zk-editor-topbar__title {
  font-size: 15px;
  font-weight: 650;
  color: var(--zk-fg);
}
.zk-root .zk-editor-layout,
.zhin-console-surface .zk-editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 310px;
  gap: 18px;
  align-items: start;
}
@media (max-width: 960px) {
  .zk-root .zk-editor-layout,
  .zhin-console-surface .zk-editor-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
.zk-root .zk-editor-main,
.zhin-console-surface .zk-editor-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.zk-root .zk-editor-side,
.zhin-console-surface .zk-editor-side {
  position: sticky;
  top: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.zk-root .zk-guide-card,
.zhin-console-surface .zk-guide-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--zk-line);
  border-radius: var(--zk-radius-lg);
  background: var(--zk-elevated);
  box-shadow: var(--zk-shadow-sm);
}
.zk-root .zk-guide-card__head,
.zhin-console-surface .zk-guide-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.zk-root .zk-guide-card__head strong,
.zhin-console-surface .zk-guide-card__head strong {
  font-size: 14px;
  font-weight: 650;
  color: var(--zk-fg);
}
.zk-root .zk-guide-steps,
.zhin-console-surface .zk-guide-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.zk-root .zk-guide-step,
.zhin-console-surface .zk-guide-step {
  padding: 8px 11px;
  border-radius: var(--zk-radius-sm);
  border: 1px solid var(--zk-line);
  background: var(--zk-surface);
  font-size: 12px;
  color: var(--zk-muted);
  line-height: 1.5;
}

/* ── Connection Mode Selector Tabs & Provider Presets ── */
.zk-root .zk-studio-block,
.zhin-console-surface .zk-studio-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.zk-root .zk-studio-label,
.zhin-console-surface .zk-studio-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--zk-muted);
}
.zk-root .zk-mode-tabs,
.zhin-console-surface .zk-mode-tabs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
}
.zk-root .zk-mode-tab,
.zhin-console-surface .zk-mode-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--zk-radius-md);
  border: 1px solid var(--zk-line);
  background: var(--zk-surface);
  color: var(--zk-fg);
  cursor: pointer;
  text-align: left;
  transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
}
.zk-root .zk-mode-tab:hover,
.zhin-console-surface .zk-mode-tab:hover {
  border-color: var(--zk-input-line);
  background: var(--zk-inset);
}
.zk-root .zk-mode-tab[aria-pressed="true"],
.zhin-console-surface .zk-mode-tab[aria-pressed="true"] {
  border-color: var(--zk-primary);
  background: var(--zk-primary-soft);
  box-shadow: 0 0 0 1px var(--zk-primary);
}
.zk-root .zk-mode-tab strong,
.zhin-console-surface .zk-mode-tab strong {
  font-size: 13.5px;
  font-weight: 650;
  color: var(--zk-fg);
}
.zk-root .zk-preset-grid,
.zhin-console-surface .zk-preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 8px;
}
.zk-root .zk-preset-card,
.zhin-console-surface .zk-preset-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px 13px;
  border-radius: var(--zk-radius-md);
  border: 1px solid var(--zk-line);
  background: var(--zk-surface);
  color: var(--zk-fg);
  cursor: pointer;
  text-align: left;
  transition: border-color 140ms ease, background-color 140ms ease;
}
.zk-root .zk-preset-card:hover,
.zhin-console-surface .zk-preset-card:hover,
.zk-root .zk-preset-card[aria-pressed="true"],
.zhin-console-surface .zk-preset-card[aria-pressed="true"] {
  border-color: var(--zk-primary);
  background: var(--zk-primary-soft);
}
.zk-root .zk-preset-card strong,
.zhin-console-surface .zk-preset-card strong {
  font-size: 13px;
  font-weight: 600;
}

/* ── Callback URL Preview & Diana-Style Input Group ── */
.zk-root .zk-callback-box,
.zhin-console-surface .zk-callback-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-radius: var(--zk-radius-md);
  border: 1px solid var(--zk-primary);
  background: var(--zk-primary-soft);
  font-size: 13px;
}
.zk-root .zk-callback-box code,
.zhin-console-surface .zk-callback-box code {
  font-family: var(--zk-font-mono);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--zk-fg);
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--zk-elevated);
}

/* ── 2-Column Responsive Form Grid & Input Groups (.form-grid / .input-group) ── */
.zk-root .zk-form-grid,
.zhin-console-surface .zk-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 14px 16px;
  align-items: start;
}
.zk-root .zk-field-cell,
.zhin-console-surface .zk-field-cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.zk-root .zk-field-cell--wide,
.zk-root .zk-field-cell--full,
.zhin-console-surface .zk-field-cell--wide,
.zhin-console-surface .zk-field-cell--full {
  grid-column: 1 / -1;
}
.zk-root .zk-input-group,
.zhin-console-surface .zk-input-group {
  display: flex;
  align-items: stretch;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.zk-root .zk-input-group > input,
.zk-root .zk-input-group > select,
.zhin-console-surface .zk-input-group > input,
.zhin-console-surface .zk-input-group > select {
  flex: 1;
  min-width: 0;
}
.zk-root .zk-option-pills,
.zhin-console-surface .zk-option-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.zk-root .zk-chip-btn,
.zhin-console-surface .zk-chip-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px 10px;
  min-height: 28px;
  border-radius: var(--zk-radius-sm);
  border: 1px solid var(--zk-line);
  background: var(--zk-surface);
  color: var(--zk-fg);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  text-decoration: none;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}
.zk-root .zk-chip-btn:hover:not(:disabled),
.zhin-console-surface .zk-chip-btn:hover:not(:disabled),
.zk-root .zk-chip-btn[aria-pressed="true"],
.zhin-console-surface .zk-chip-btn[aria-pressed="true"] {
  border-color: var(--zk-primary);
  color: var(--zk-primary);
  background: var(--zk-primary-soft);
}
.zk-root .zk-chip-btn:disabled,
.zhin-console-surface .zk-chip-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.zk-root .zk-group-header,
.zhin-console-surface .zk-group-header {
  grid-column: 1 / -1;
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--zk-line);
  font-size: 12.5px;
  font-weight: 650;
  color: var(--zk-fg);
}
.zk-root .zk-advanced-details,
.zhin-console-surface .zk-advanced-details {
  grid-column: 1 / -1;
  border: 1px solid var(--zk-line);
  border-radius: var(--zk-radius-md);
  background: var(--zk-surface);
  padding: 10px 14px;
}
.zk-root .zk-advanced-details > summary,
.zhin-console-surface .zk-advanced-details > summary {
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--zk-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.zk-root .zk-advanced-details[open] > summary,
.zhin-console-surface .zk-advanced-details[open] > summary {
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--zk-line);
  color: var(--zk-fg);
}

/* ── Login Verification & QQ Official Dual-Track Workbench ── */
.zk-root .zk-login-steps,
.zhin-console-surface .zk-login-steps {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.zk-root .zk-login-step,
.zhin-console-surface .zk-login-step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 11px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid var(--zk-line);
  background: var(--zk-surface);
  color: var(--zk-muted);
}
.zk-root .zk-login-step--active,
.zhin-console-surface .zk-login-step--active {
  border-color: var(--zk-warning);
  background: var(--zk-warning-soft);
  color: var(--zk-warning);
  font-weight: 600;
}
.zk-root .zk-qq-workbench,
.zhin-console-surface .zk-qq-workbench {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  border: 1px solid var(--zk-line);
  border-radius: var(--zk-radius-lg);
  background: var(--zk-elevated);
  box-shadow: var(--zk-shadow-sm);
}
.zk-root .zk-qq-kind-grid,
.zhin-console-surface .zk-qq-kind-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}
.zk-root .zk-slider-guide,
.zhin-console-surface .zk-slider-guide {
  padding: 8px 12px;
  border-radius: var(--zk-radius-sm);
  border: 1px solid var(--zk-line);
  background: var(--zk-surface);
}
`;

/** 适配器页面样式：`@zhin.js/client/ui` 套件样式 + Diana 风格平台账号工作台样式。 */
export const adapterConsoleStyles = `${pluginUiStyles}${adapterStudioStyles}`;
