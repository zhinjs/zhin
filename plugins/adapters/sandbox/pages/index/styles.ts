/**
 * The Sandbox workbench owns its complete presentation. Every colour derives from the Console theme tokens
 * (`--background`, `--primary`, ...) with a light fallback so the page also renders outside the Console, and
 * nothing here relies on Tailwind utilities or on the shared adapter-console stylesheet being injected first.
 * Rules: no hex literals, no gradients, no text below 12px, tap targets of at least 44px under 768px.
 * Sizes are Console tokens (ADR 0063 P2): font sizes / weights, spacing, radii and elevation read
 * `var(--console-…)` from @zhin.js/console-ui, breakpoints are the Console ones (40 / 48 / 64 / 90rem).
 * The code-block syntax palette below keeps its own colors (a code theme, not UI chrome).
 */
export const sandboxStyles = `
.zhin-sandbox {
  --sb-bg: hsl(var(--background, 0 0% 100%));
  --sb-fg: hsl(var(--foreground, 0 0% 12%));
  --sb-muted: hsl(var(--muted, 0 0% 96%));
  --sb-muted-fg: hsl(var(--muted-foreground, 0 0% 39%));
  --sb-accent: hsl(var(--accent, 0 0% 95%));
  --sb-border: hsl(var(--border, 0 0% 90%));
  --sb-border-soft: hsl(var(--border, 0 0% 90%) / .7);
  --sb-input: hsl(var(--input, 0 0% 57%));
  --sb-sidebar: hsl(var(--sidebar, 0 0% 97%));
  --sb-primary: hsl(var(--primary, 222 62% 50%));
  --sb-primary-fg: hsl(var(--primary-foreground, 0 0% 99%));
  --sb-primary-soft: hsl(var(--primary, 222 62% 50%) / .1);
  --sb-primary-line: hsl(var(--primary, 222 62% 50%) / .3);
  --sb-ring: hsl(var(--ring, 222 62% 50%));
  --sb-danger: hsl(var(--destructive, 0 68% 42%));
  --sb-danger-fg: hsl(var(--destructive-foreground, 0 0% 100%));
  --sb-danger-soft: hsl(var(--destructive, 0 68% 42%) / .1);
  --sb-danger-line: hsl(var(--destructive, 0 68% 42%) / .3);
  --sb-ok: hsl(var(--success, 145 52% 28%));
  --sb-warn: hsl(var(--warning, 32 80% 30%));
  --sb-warn-soft: hsl(var(--warning, 32 80% 30%) / .12);
  --sb-warn-line: hsl(var(--warning, 32 80% 30%) / .32);
  --sb-info: hsl(var(--info, 222 62% 50%));
  --sb-overlay: hsl(var(--im-shadow, 0 0% 0%) / .5);
  --sb-shadow: hsl(var(--im-shadow, 0 0% 0%) / .16);
  --sb-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'PingFang SC', monospace;
  color: var(--sb-fg);
  font-family: 'Avenir Next', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  font-size: var(--console-text-body);
  line-height: 1.6;
  text-align: left;
}
.zhin-sandbox *, .zhin-sandbox *::before, .zhin-sandbox *::after { box-sizing: border-box; }
.zhin-sandbox :where(h1, h2, h3, h4, h5, h6, p, ul, ol, dl, dd, figure, pre) { margin: 0; }
.zhin-sandbox :where(button, input, select, textarea):where(:not(.console-control, [data-state])) { font: inherit; color: inherit; }
.zhin-sandbox :where(a):where(:not(.console-control, [data-state])) { color: var(--sb-primary); text-underline-offset: 3px; overflow-wrap: anywhere; }
.zhin-sandbox :where(button, a, input, select, textarea, summary):focus-visible:where(:not(.console-control, [data-state])) { outline: 2px solid var(--sb-ring); outline-offset: 2px; }
.zhin-sandbox [hidden] { display: none !important; }

/* ---------- Shell ---------- */
.zhin-sandbox.agent-playground-shell { position: relative; display: grid; grid-template-columns: 232px minmax(0,1fr); width: 100%; height: calc(100dvh - 72px); min-height: 520px; overflow: hidden; isolation: isolate; border: 1px solid var(--sb-border); border-radius: var(--console-radius-3); background: var(--sb-bg); }

/* ---------- Shared controls ---------- */
.zhin-sandbox button:where(:not(.console-control, [data-state])) { display: inline-flex; justify-content: center; align-items: center; gap: var(--console-space-2); min-height: 34px; padding: var(--console-space-2) var(--console-space-3); border: 1px solid var(--sb-border); border-radius: var(--console-radius-1); background: var(--sb-bg); color: var(--sb-fg); font-size: var(--console-text-label); line-height: 1.4; cursor: pointer; transition: background-color .16s ease, border-color .16s ease, color .16s ease; }
.zhin-sandbox button:hover:not(:disabled):where(:not(.console-control, [data-state])) { background: var(--sb-accent); }
.zhin-sandbox button:disabled:where(:not(.console-control, [data-state])) { opacity: .5; cursor: not-allowed; }
.zhin-sandbox button.primary:where(:not(.console-control, [data-state])) { background: var(--sb-primary); color: var(--sb-primary-fg); border-color: var(--sb-primary); }
.zhin-sandbox button.primary:hover:not(:disabled):where(:not(.console-control, [data-state])) { background: var(--sb-primary); opacity: .9; }
.zhin-sandbox button.danger:where(:not(.console-control, [data-state])) { background: var(--sb-danger); color: var(--sb-danger-fg); border-color: var(--sb-danger); }
.zhin-sandbox button.danger:hover:not(:disabled):where(:not(.console-control, [data-state])) { background: var(--sb-danger); opacity: .9; }
.zhin-sandbox :where(input:not([type="checkbox"]), select):where(:not(.console-control, [data-state])) { width: 100%; min-width: 0; min-height: 34px; padding: var(--console-space-2) var(--console-space-3); border: 1px solid var(--sb-input); border-radius: var(--console-radius-1); background: var(--sb-bg); color: var(--sb-fg); font-size: var(--console-text-label); line-height: 1.5; }
.zhin-sandbox :where(input, select):disabled:where(:not(.console-control, [data-state])) { opacity: .6; cursor: not-allowed; background: var(--sb-muted); }
.zhin-sandbox :where(input):where(:not(.console-control, [data-state]))::placeholder { color: var(--sb-muted-fg); }
.zhin-sandbox .is-spinning { animation: sandbox-spin 1s linear infinite; }

/* ---------- Mobile bar and overlays (hidden on wide screens) ---------- */
.zhin-sandbox .agent-playground-inspector-overlay, .zhin-sandbox .channel-overlay { display: none; }

/* ---------- Sessions sidebar ---------- */
.zhin-sandbox .agent-playground-sessions { min-width: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--sb-sidebar); border-right: 1px solid var(--sb-border); }
.zhin-sandbox .agent-playground-brand { padding: var(--console-space-5) var(--console-space-4) var(--console-space-4); border-bottom: 1px solid var(--sb-border-soft); }
.zhin-sandbox .agent-playground-brand > div { display: flex; align-items: center; justify-content: space-between; gap: var(--console-space-2); }
.zhin-sandbox .agent-playground-brand > div > div { display: flex; align-items: center; gap: var(--console-space-3); min-width: 0; }
.zhin-sandbox .agent-playground-brand h2 { font-size: var(--console-text-section); font-weight: var(--console-weight-strong); letter-spacing: -.02em; }
.zhin-sandbox .agent-playground-brand small { display: block; font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-mark, .zhin-sandbox .agent-playground-empty-mark { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--sb-primary); background: var(--sb-primary-soft); }
.zhin-sandbox .agent-playground-mark { width: 32px; height: 32px; border: 1px solid var(--sb-primary-line); border-radius: var(--console-radius-2); }
.zhin-sandbox .agent-playground-connection { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 28px; height: 28px; border: 1px solid var(--sb-border); border-radius: var(--console-radius-full); background: var(--sb-bg); color: var(--sb-warn); }
.zhin-sandbox .agent-playground-connection.is-online { color: var(--sb-ok); border-color: var(--sb-primary-line); }
.zhin-sandbox .is-online { color: var(--sb-ok); }
.zhin-sandbox .agent-playground-section-label { display: flex; align-items: center; gap: var(--console-space-2); padding: var(--console-space-3) var(--console-space-4) var(--console-space-2) var(--console-space-4); font-size: var(--console-text-label); font-weight: var(--console-weight-strong); letter-spacing: .04em; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-section-label span:nth-child(2) { font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-section-label button:where(:not(.console-control, [data-state])) { margin-left: auto; min-height: 28px; min-width: 28px; padding: var(--console-space-1); background: transparent; border-color: transparent; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-session-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 var(--console-space-2) var(--console-space-3); scrollbar-width: thin; }
.zhin-sandbox .agent-playground-session { position: relative; width: 100%; justify-content: flex-start; gap: var(--console-space-3); margin: var(--console-space-1) 0; padding: var(--console-space-2) var(--console-space-3); border: 0; border-radius: var(--console-radius-2); background: transparent; text-align: left; }
.zhin-sandbox .agent-playground-session:hover:not(:disabled) { background: var(--sb-bg); }
.zhin-sandbox .agent-playground-session.active { background: var(--sb-bg); border-inline-start: var(--console-border-focus) solid var(--sb-primary); }
.zhin-sandbox .agent-playground-session-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 32px; height: 32px; border-radius: var(--console-radius-2); background: var(--sb-muted); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-session.active .agent-playground-session-icon { background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-session-copy { flex: 1; min-width: 0; }
.zhin-sandbox .agent-playground-session-title { font-size: var(--console-text-label); font-weight: var(--console-weight-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-session-scope { margin-top: var(--console-space-1); font-size: var(--console-text-label); color: var(--sb-muted-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-unread { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; min-width: 20px; height: 20px; padding: 0 var(--console-space-2); border-radius: var(--console-radius-full); background: var(--sb-danger); color: var(--sb-danger-fg); font-size: var(--console-text-label); font-weight: var(--console-weight-strong); font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-new-session { padding: var(--console-space-3) var(--console-space-3); border-top: 1px solid var(--sb-border-soft); }
.zhin-sandbox .agent-playground-new-form { display: grid; gap: var(--console-space-2); }
.zhin-sandbox .agent-playground-scope-picker { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--console-space-1); padding: var(--console-space-1); border-radius: var(--console-radius-2); background: var(--sb-muted); }
.zhin-sandbox .agent-playground-scope-picker button:where(:not(.console-control, [data-state])) { min-height: 30px; padding: var(--console-space-1); border: 0; background: transparent; color: var(--sb-muted-fg); font-size: var(--console-text-label); }
.zhin-sandbox .agent-playground-scope-picker button.active:where(:not(.console-control, [data-state])) { background: var(--sb-bg); color: var(--sb-fg); box-shadow: var(--console-elevation-1); }
.zhin-sandbox .agent-playground-new-actions { display: flex; justify-content: flex-end; gap: var(--console-space-2); }
.zhin-sandbox .agent-playground-endpoint { display: flex; align-items: center; justify-content: space-between; gap: var(--console-space-2); min-width: 0; padding: var(--console-space-3) var(--console-space-4) var(--console-space-3); border-top: 1px solid var(--sb-border-soft); font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-endpoint strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--sb-mono); font-size: var(--console-text-label); font-weight: var(--console-weight-medium); color: var(--sb-fg); }

/* ---------- Main column: run bar ---------- */
.zhin-sandbox .agent-playground-main { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; background: var(--sb-bg); }
.zhin-sandbox .agent-playground-runbar { display: flex; flex-shrink: 0; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--console-space-3) var(--console-space-4); min-height: 68px; padding: var(--console-space-3) var(--console-space-5); border-bottom: 1px solid var(--sb-border-soft); }
.zhin-sandbox .agent-playground-run-identity { display: flex; flex: 1 1 14rem; align-items: center; gap: var(--console-space-3); min-width: 0; }
.zhin-sandbox .agent-playground-run-identity > div { flex: 1; min-width: 0; }
.zhin-sandbox .agent-playground-run-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 36px; height: 36px; border: 1px solid var(--sb-primary-line); border-radius: var(--console-radius-2); background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-run-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--console-space-2); min-width: 0; }
.zhin-sandbox .agent-playground-run-title h2 { min-width: 0; max-width: 100%; overflow: hidden; font-size: var(--console-text-section); font-weight: var(--console-weight-strong); letter-spacing: -.02em; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-run-title span { flex-shrink: 0; padding: 0 var(--console-space-2); border: 1px solid var(--sb-border); border-radius: var(--console-radius-full); font-size: var(--console-text-label); font-weight: var(--console-weight-strong); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-run-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--console-space-2); min-width: 0; max-width: 100%; margin-left: auto; }
.zhin-sandbox .agent-playground-run-actions > a:where(:not(.console-control, [data-state])) { display: inline-flex; align-items: center; justify-content: center; gap: var(--console-space-2); min-height: 34px; padding: var(--console-space-2) var(--console-space-3); border: 1px solid var(--sb-border); border-radius: var(--console-radius-1); color: var(--sb-muted-fg); font-size: var(--console-text-label); text-decoration: none; }
.zhin-sandbox .agent-playground-run-actions > a:hover:where(:not(.console-control, [data-state])) { background: var(--sb-accent); color: var(--sb-fg); }
.zhin-sandbox .agent-playground-run-actions > button:where(:not(.console-control, [data-state])) { color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-run-actions > button:hover:not(:disabled):where(:not(.console-control, [data-state])) { border-color: var(--sb-primary-line); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-run-actions > button.active:where(:not(.console-control, [data-state])) { border-color: var(--sb-primary-line); background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-run-state { display: inline-flex; align-items: center; gap: var(--console-space-2); margin-right: var(--console-space-1); color: var(--sb-muted-fg); font-size: var(--console-text-label); white-space: nowrap; }
.zhin-sandbox .agent-playground-run-state.is-running { color: var(--sb-primary); }
.zhin-sandbox .agent-playground-run-state.is-running svg { animation: sandbox-breathe 1.5s ease-in-out infinite; }
.zhin-sandbox .agent-playground-run-state.has-problem { color: var(--sb-danger); }

/* ---------- Banners and run settings ---------- */
.zhin-sandbox .agent-playground-run-settings { position: relative; z-index: 3; display: flex; flex-wrap: wrap; gap: var(--console-space-3); padding: var(--console-space-3) var(--console-space-5); border-bottom: 1px solid var(--sb-border-soft); background: var(--sb-sidebar); }
.zhin-sandbox .agent-playground-run-settings label, .zhin-sandbox .agent-playground-run-settings .sandbox-field { display: flex; flex: 1 1 140px; flex-direction: column; gap: var(--console-space-1); min-width: 0; }
.zhin-sandbox .agent-playground-run-settings .agent-playground-directory-field { flex-basis: 100%; }
.zhin-sandbox .agent-playground-run-settings label > span, .zhin-sandbox .agent-playground-run-settings .sandbox-field > span { display: flex; align-items: center; gap: var(--console-space-1); font-size: var(--console-text-label); font-weight: var(--console-weight-strong); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-run-settings > p { display: flex; flex-basis: 100%; align-items: flex-start; gap: var(--console-space-2); font-size: var(--console-text-label); color: var(--sb-warn); }
.zhin-sandbox .agent-playground-run-settings > p > svg { flex-shrink: 0; margin-top: var(--console-space-1); }
.zhin-sandbox .agent-playground-network-toggle { position: relative; flex: none !important; flex-direction: row !important; align-items: center; gap: var(--console-space-3) !important; }

/* ---------- Conversation ---------- */
.zhin-sandbox .agent-playground-conversation { position: relative; flex: 1; display: flex; min-height: 0; overflow: hidden; }
.zhin-sandbox .agent-playground-message-scroll { flex: 1; min-width: 0; height: 100%; overflow-y: auto; overscroll-behavior: contain; padding: var(--console-space-5) var(--console-space-5); scrollbar-gutter: stable; scrollbar-width: thin; }
.zhin-sandbox .agent-playground-conversation-details { flex: 1; min-height: 0; overflow: auto; padding: var(--console-space-4); }
.zhin-sandbox .agent-playground-history-navigation, .zhin-sandbox .agent-playground-history-notice { padding: var(--console-space-2) var(--console-space-4); font-size: var(--console-text-label); text-align: center; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-history-navigation p[role=alert] { color: var(--sb-danger); overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-history-navigation button:where(:not(.console-control, [data-state])) { min-height: 32px; border-color: transparent; background: transparent; color: var(--sb-primary); }
.zhin-sandbox .agent-playground-empty { display: grid; width: min(100%, calc(var(--console-content-reading) * 0.7)); min-height: 100%; align-content: center; margin: 0 auto; padding: var(--console-space-6) 0; text-align: center; }
.zhin-sandbox .agent-playground-empty-mark { width: 56px; height: 56px; margin: 0 auto var(--console-space-4); border: 1px solid var(--sb-primary-line); border-radius: var(--console-radius-3); }
.zhin-sandbox .agent-playground-empty h2 { font-size: var(--console-text-title); font-weight: var(--console-weight-strong); letter-spacing: -.025em; margin-bottom: var(--console-space-2); }
.zhin-sandbox .agent-playground-empty p { max-width: 48ch; margin: 0 auto; color: var(--sb-muted-fg); font-size: var(--console-text-body); line-height: 1.7; }
.zhin-sandbox .agent-playground-prompts { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: var(--console-space-2); margin-top: var(--console-space-5); }
.zhin-sandbox .agent-playground-prompts button:where(:not(.console-control, [data-state])) { flex-direction: column; align-items: flex-start; justify-content: flex-start; min-height: 64px; padding: var(--console-space-3); border-radius: var(--console-radius-2); font-size: var(--console-text-label); text-align: left; }
.zhin-sandbox .agent-playground-prompts button:where(:not(.console-control, [data-state]))::after { margin-top: auto; color: var(--sb-primary); content: "\\2197"; }
.zhin-sandbox .agent-playground-prompts button:hover:not(:disabled):where(:not(.console-control, [data-state])) { border-color: var(--sb-primary-line); background: var(--sb-muted); }
.zhin-sandbox .agent-playground-message-list { display: flex; flex-direction: column; gap: var(--console-space-4); width: min(100%, calc(var(--console-content-reading) * 0.875)); margin: 0 auto; padding-bottom: var(--console-space-3); }
.zhin-sandbox .agent-playground-message { display: flex; align-items: flex-start; gap: var(--console-space-3); }
.zhin-sandbox .agent-playground-message.is-user { flex-direction: row-reverse; }
.zhin-sandbox .agent-playground-message-avatar { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 30px; height: 30px; border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-muted); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-message.is-agent .agent-playground-message-avatar { border-color: var(--sb-primary-line); background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-message-main { min-width: 0; max-width: calc(100% - 44px); }
.zhin-sandbox .agent-playground-message.is-user .agent-playground-message-main { max-width: min(76%, calc(var(--console-content-reading) * 0.7)); }
.zhin-sandbox .agent-playground-message-meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--console-space-1) var(--console-space-2); margin: 0 var(--console-space-1) var(--console-space-1); font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-message.is-user .agent-playground-message-meta { justify-content: flex-end; }
.zhin-sandbox .agent-playground-message-meta strong { font-weight: var(--console-weight-strong); color: var(--sb-fg); }
.zhin-sandbox .agent-playground-message-meta span { color: var(--sb-warn); }
.zhin-sandbox .agent-playground-message-content { min-width: 0; padding: var(--console-space-3) var(--console-space-4); border: 1px solid var(--sb-border); border-radius: var(--console-radius-3); background: var(--sb-bg); line-height: 1.7; overflow-wrap: anywhere; overflow: hidden; }
.zhin-sandbox .agent-playground-message-content img { max-width: 100%; border-radius: var(--console-radius-2); }
.zhin-sandbox .agent-playground-message-content > :first-child { margin-top: 0; }
.zhin-sandbox .agent-playground-message-content > :last-child { margin-bottom: 0; }
.zhin-sandbox .agent-playground-message.is-user .agent-playground-message-content { border-color: var(--sb-primary-line); background: var(--sb-primary-soft); }
.zhin-sandbox .agent-playground-message.is-approval .agent-playground-message-avatar { border-color: var(--sb-warn-line); background: var(--sb-warn-soft); color: var(--sb-warn); }
.zhin-sandbox .agent-playground-message.is-approval .agent-playground-message-content { border-color: var(--sb-warn-line); background: var(--sb-warn-soft); }
.zhin-sandbox .agent-playground-message.is-approval .agent-playground-message-meta span:last-of-type { padding: 0 var(--console-space-2); border: 1px solid var(--sb-warn-line); border-radius: var(--console-radius-full); font-weight: var(--console-weight-strong); }
.zhin-sandbox .agent-playground-approval-actions { display: grid; gap: var(--console-space-2); margin-top: var(--console-space-3); padding-top: var(--console-space-3); border-top: 1px solid var(--sb-warn-line); }
.zhin-sandbox .agent-playground-approval-actions > div { display: flex; flex-wrap: wrap; gap: var(--console-space-2); }
.zhin-sandbox .agent-playground-approval-actions button:where(:not(.console-control, [data-state])) { min-height: 34px; font-weight: var(--console-weight-strong); }
.zhin-sandbox .agent-playground-approval-actions button.is-primary:where(:not(.console-control, [data-state])) { background: var(--sb-primary); border-color: var(--sb-primary); color: var(--sb-primary-fg); }
.zhin-sandbox .agent-playground-approval-actions button.is-danger:where(:not(.console-control, [data-state])) { background: var(--sb-danger-soft); border-color: var(--sb-danger-line); color: var(--sb-danger); }
.zhin-sandbox .agent-playground-approval-actions small { display: inline-flex; align-items: center; gap: var(--console-space-1); font-size: var(--console-text-label); color: var(--sb-primary); }

/* ---------- Message segments (formerly Tailwind utilities) ---------- */
.zhin-sandbox .sandbox-chip { display: inline-flex; align-items: center; margin: 0 var(--console-space-1); padding: 0 var(--console-space-2); border-radius: var(--console-radius-1); background: var(--sb-muted); color: var(--sb-fg); font-size: var(--console-text-label); }
.zhin-sandbox .sandbox-chip.is-mention { background: var(--sb-accent); }
.zhin-sandbox .sandbox-inline-face { display: inline-block; width: 24px; height: 24px; margin: 0 var(--console-space-1); vertical-align: middle; }
.zhin-sandbox .sandbox-segment-note { font-size: var(--console-text-label); opacity: .8; }
.zhin-sandbox .sandbox-media-link { display: block; margin: var(--console-space-1) 0; }
.zhin-sandbox .sandbox-media-image { display: block; max-width: min(320px, 88%); border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); }
.zhin-sandbox .sandbox-media-video { display: block; max-width: min(360px, 92%); max-height: 288px; margin: var(--console-space-1) 0; border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-muted); }
.zhin-sandbox .sandbox-media-audio { display: block; width: 100%; max-width: 384px; height: 40px; margin: var(--console-space-2) 0; }
.zhin-sandbox .sandbox-html-frame { display: block; width: 100%; min-width: 0; margin: var(--console-space-1) 0; border: 0; border-radius: var(--console-radius-2); background: transparent; }
/* #1250 command-menu-unreadable-in-sandbox: the scaled box takes the message column's width (never the
   design width of its frame), and the absolutely positioned frame stays out of the bubble's sizing. */
.zhin-sandbox .sandbox-html-scaled { position: relative; width: 100%; min-width: 0; margin: var(--console-space-1) 0; overflow: hidden; border-radius: var(--console-radius-2); }
.zhin-sandbox .sandbox-html-scaled > .sandbox-html-frame { position: absolute; top: 0; left: 0; margin: 0; max-width: none; border-radius: 0; }
.zhin-sandbox .agent-playground-message-main:has(.sandbox-html-scaled),
.zhin-sandbox .agent-playground-message-content:has(.sandbox-html-scaled) { width: 100%; min-width: 0; }
.zhin-sandbox .sandbox-reply-quote { margin-bottom: var(--console-space-1); padding: var(--console-space-1) var(--console-space-2); border: 1px dashed var(--sb-input); border-radius: var(--console-radius-1); font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-forward { display: grid; gap: var(--console-space-1); margin: var(--console-space-1) 0; padding: var(--console-space-2); border: 1px solid var(--sb-border); border-radius: var(--console-radius-1); background: var(--sb-muted); font-size: var(--console-text-label); }
.zhin-sandbox .sandbox-forward-title { font-weight: var(--console-weight-strong); }
.zhin-sandbox .sandbox-forward-list { display: grid; gap: var(--console-space-1); padding-left: var(--console-space-2); border-left: 2px solid var(--sb-border); }
.zhin-sandbox .sandbox-forward-more, .zhin-sandbox .sandbox-forward-empty { color: var(--sb-muted-fg); }

/* ---------- Rendered Markdown, lists, tables, code ---------- */
.zhin-sandbox .zhin-markdown { min-width: 0; color: inherit; font-size: var(--console-text-body); line-height: 1.7; overflow-wrap: anywhere; }
.zhin-sandbox .zhin-markdown > * + * { margin-top: var(--console-space-2); }
.zhin-sandbox .zhin-markdown--inverse { color: inherit; }
.zhin-sandbox .im-markdown-heading { font-weight: var(--console-weight-strong); line-height: 1.35; letter-spacing: -.01em; }
.zhin-sandbox .im-markdown-heading-1 { font-size: var(--console-text-title); }
.zhin-sandbox .im-markdown-heading-2 { font-size: var(--console-text-section); }
.zhin-sandbox .im-markdown-heading-3 { font-size: var(--console-text-section); }
.zhin-sandbox .im-markdown-heading-4, .zhin-sandbox .im-markdown-heading-5, .zhin-sandbox .im-markdown-heading-6 { font-size: var(--console-text-body); }
.zhin-sandbox .im-markdown-paragraph { margin: 0; }
.zhin-sandbox .im-markdown-quote { padding: var(--console-space-1) var(--console-space-3); border-left: 3px solid var(--sb-border); color: var(--sb-muted-fg); }
.zhin-sandbox .im-markdown-list { padding-left: var(--console-space-5); list-style: disc; }
.zhin-sandbox .im-markdown-list-ordered { list-style: decimal; }
.zhin-sandbox .im-markdown-list > li { padding-left: var(--console-space-1); }
.zhin-sandbox .im-markdown-list > li + li { margin-top: var(--console-space-1); }
.zhin-sandbox .im-markdown-list > li::marker { color: var(--sb-muted-fg); }
.zhin-sandbox .zhin-markdown-task { display: flex; align-items: baseline; gap: var(--console-space-2); margin-left: calc(var(--console-space-5) * -1); list-style: none; }
.zhin-sandbox .zhin-markdown-task input:where(:not(.console-control, [data-state])) { flex-shrink: 0; width: 14px; height: 14px; min-height: 0; margin: 0; padding: 0; accent-color: var(--sb-primary); transform: translateY(2px); }
.zhin-sandbox .zhin-markdown-rule { width: 100%; margin: var(--console-space-2) 0; border: 0; border-top: 1px solid var(--sb-border); }
.zhin-sandbox .im-inline-code { padding: 0 var(--console-space-2); border: 1px solid var(--sb-border); border-radius: var(--console-radius-1); background: var(--sb-muted); font-family: var(--sb-mono); font-size: var(--console-text-label); }
.zhin-sandbox .im-message-link { color: var(--sb-primary); }
.zhin-sandbox .zhin-markdown-table-wrap { width: 100%; max-width: 100%; overflow-x: auto; border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-bg); }
.zhin-sandbox .zhin-markdown-table { width: 100%; min-width: 320px; border-collapse: collapse; font-size: var(--console-text-label); line-height: 1.5; font-variant-numeric: tabular-nums; }
.zhin-sandbox .zhin-markdown-table th, .zhin-sandbox .zhin-markdown-table td { padding: var(--console-space-2) var(--console-space-3); border-right: 1px solid var(--sb-border); border-bottom: 1px solid var(--sb-border); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.zhin-sandbox .zhin-markdown-table th { background: var(--sb-muted); font-weight: var(--console-weight-strong); white-space: nowrap; }
.zhin-sandbox .zhin-markdown-table tbody tr:nth-child(even) td { background: var(--sb-muted); }
.zhin-sandbox .zhin-markdown-table tr:last-child td { border-bottom: 0; }
.zhin-sandbox .zhin-markdown-table th:last-child, .zhin-sandbox .zhin-markdown-table td:last-child { border-right: 0; }
.zhin-sandbox .zhin-code-block { width: 100%; max-width: 100%; min-width: 0; overflow: hidden; margin: var(--console-space-1) 0; border: 1px solid hsl(218 18% 28%); border-radius: var(--console-radius-2); background: hsl(220 19% 10%); color: hsl(210 30% 92%); font-family: var(--sb-mono); }
.zhin-sandbox .zhin-code-toolbar { display: flex; align-items: center; gap: var(--console-space-2); min-height: 36px; padding: var(--console-space-1) var(--console-space-2) var(--console-space-1) var(--console-space-3); border-bottom: 1px solid hsl(218 16% 24%); background: hsl(220 18% 13%); }
.zhin-sandbox .zhin-code-language { color: hsl(210 14% 72%); font-size: var(--console-text-label); font-weight: var(--console-weight-strong); letter-spacing: .04em; }
.zhin-sandbox .zhin-code-streaming { color: hsl(151 48% 63%); font-size: var(--console-text-label); }
.zhin-sandbox .zhin-code-streaming::before { display: inline-block; width: 6px; height: 6px; margin-right: var(--console-space-1); border-radius: var(--console-radius-full); background: currentColor; content: ""; animation: sandbox-breathe 1.2s ease-in-out infinite; }
.zhin-sandbox .zhin-code-actions { display: flex; gap: var(--console-space-1); margin-left: auto; }
.zhin-sandbox .zhin-code-actions button:where(:not(.console-control, [data-state])), .zhin-sandbox .zhin-code-expand { min-height: 28px; border: 0; border-radius: var(--console-radius-1); background: transparent; color: hsl(210 14% 76%); font-size: var(--console-text-label); }
.zhin-sandbox .zhin-code-actions button:hover:not(:disabled):where(:not(.console-control, [data-state])), .zhin-sandbox .zhin-code-expand:hover:not(:disabled) { background: hsl(215 18% 21%); color: hsl(0 0% 100%); }
.zhin-sandbox .zhin-code-pre { max-width: 100%; overflow: auto; padding: var(--console-space-2) 0 var(--console-space-3); font: inherit; font-size: var(--console-text-label); line-height: 1.65; tab-size: 2; }
.zhin-sandbox .zhin-code-pre--wrap .zhin-code-line-content { white-space: pre-wrap; overflow-wrap: anywhere; }
.zhin-sandbox .zhin-code-line { display: table-row; }
.zhin-sandbox .zhin-code-line-number { display: table-cell; width: 42px; padding: 0 var(--console-space-3) 0 var(--console-space-2); color: hsl(214 12% 55%); text-align: right; user-select: none; }
.zhin-sandbox .zhin-code-line-content { display: table-cell; min-width: 100%; padding-right: var(--console-space-4); white-space: pre; }
.zhin-sandbox .zhin-code-token--comment { color: hsl(148 23% 60%); font-style: italic; }
.zhin-sandbox .zhin-code-token--string { color: hsl(44 68% 70%); }
.zhin-sandbox .zhin-code-token--number { color: hsl(192 62% 68%); }
.zhin-sandbox .zhin-code-token--keyword { color: hsl(328 63% 73%); font-weight: var(--console-weight-medium); }
.zhin-sandbox .zhin-code-token--literal { color: hsl(268 72% 76%); }
.zhin-sandbox .zhin-code-expand { width: 100%; padding: var(--console-space-2); border-top: 1px solid hsl(218 16% 22%); border-radius: 0; background: hsl(220 18% 12%); }

/* ---------- Recovery panel ---------- */
.zhin-sandbox .agent-playground-recovery { display: grid; flex: none; gap: var(--console-space-3); max-height: min(40dvh, 24rem); margin: var(--console-space-4); overflow: auto; font-size: var(--console-text-body); }
.zhin-sandbox .agent-playground-recovery > section, .zhin-sandbox .agent-playground-recovery > details { min-width: 0; padding: var(--console-space-4); border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-bg); }
.zhin-sandbox .agent-playground-recovery h3 { margin-bottom: var(--console-space-3); font-size: var(--console-text-body); font-weight: var(--console-weight-strong); }
.zhin-sandbox .agent-playground-recovery summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--console-space-2) var(--console-space-4); cursor: pointer; }
.zhin-sandbox .agent-playground-recovery time { margin-left: auto; font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-recovery details[open] summary { margin-bottom: var(--console-space-4); }
.zhin-sandbox .agent-playground-recovery details > a:where(:not(.console-control, [data-state])) { display: inline-flex; margin: var(--console-space-2) var(--console-space-3) 0 0; }
.zhin-sandbox .agent-playground-recovery > p[role=alert] { color: var(--sb-danger); overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-recovery > button:where(:not(.console-control, [data-state])), .zhin-sandbox .agent-playground-recovery > p > button:where(:not(.console-control, [data-state])) { color: var(--sb-primary); }
.zhin-sandbox .agent-playground-main:has(> .agent-playground-recovery:not([hidden])) .agent-playground-empty { display: none; }

/* ---------- Inline run card ---------- */
.zhin-sandbox .agent-playground-inline-run { position: relative; overflow: hidden; margin-left: var(--console-space-7); border: 1px solid var(--sb-border); border-radius: var(--console-radius-3); background: var(--sb-bg); }
.zhin-sandbox .agent-playground-inline-run-rail { position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--sb-primary); }
.zhin-sandbox .agent-playground-inline-run.is-running .agent-playground-inline-run-rail { background: var(--sb-info); }
.zhin-sandbox .agent-playground-inline-run.is-failed .agent-playground-inline-run-rail { background: var(--sb-danger); }
.zhin-sandbox .agent-playground-inline-run.is-cancelled .agent-playground-inline-run-rail { background: var(--sb-warn); }
.zhin-sandbox .agent-playground-inline-run-head { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: start; gap: var(--console-space-3); padding: var(--console-space-4) var(--console-space-4) var(--console-space-3) var(--console-space-4); }
.zhin-sandbox .agent-playground-inline-run-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid var(--sb-primary-line); border-radius: var(--console-radius-2); background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-inline-run-copy { min-width: 0; }
.zhin-sandbox .agent-playground-inline-run-copy > span { display: block; font-size: var(--console-text-label); font-weight: var(--console-weight-strong); letter-spacing: .04em; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-inline-run-copy h3 { font-size: var(--console-text-body); font-weight: var(--console-weight-strong); }
.zhin-sandbox .agent-playground-inline-run-copy p { display: -webkit-box; margin-top: var(--console-space-1); overflow: hidden; font-size: var(--console-text-label); line-height: 1.5; color: var(--sb-muted-fg); overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.zhin-sandbox .agent-playground-inline-run-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--console-space-2); }
.zhin-sandbox .agent-playground-inline-run-actions button:where(:not(.console-control, [data-state])) { min-height: 30px; padding: var(--console-space-1) var(--console-space-3); font-size: var(--console-text-label); font-weight: var(--console-weight-strong); }
.zhin-sandbox .agent-playground-inline-run-actions button.is-stop:where(:not(.console-control, [data-state])) { background: var(--sb-danger-soft); border-color: var(--sb-danger-line); color: var(--sb-danger); }
.zhin-sandbox .agent-playground-inline-run-metrics { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); margin: 0; border-top: 1px solid var(--sb-border); border-bottom: 1px solid var(--sb-border); background: var(--sb-muted); font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-inline-run-metrics > div { display: flex; align-items: baseline; justify-content: center; gap: var(--console-space-1); min-width: 0; padding: var(--console-space-2) var(--console-space-2); border-right: 1px solid var(--sb-border); }
.zhin-sandbox .agent-playground-inline-run-metrics > div:last-child { border-right: 0; }
.zhin-sandbox .agent-playground-inline-run-metrics dt { font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-inline-run-metrics dd { overflow: hidden; font-size: var(--console-text-label); font-weight: var(--console-weight-strong); text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-inline-run-metrics .has-problem dd { color: var(--sb-danger); }
.zhin-sandbox .agent-playground-inline-run-steps { display: grid; padding: var(--console-space-2) var(--console-space-4) var(--console-space-2) var(--console-space-4); list-style: none; }
.zhin-sandbox .agent-playground-inline-run-steps li { position: relative; display: grid; grid-template-columns: 12px minmax(0,1fr) auto; align-items: center; gap: var(--console-space-2); min-height: 34px; }
.zhin-sandbox .agent-playground-inline-run-steps li:not(:last-child)::after { position: absolute; top: 20px; bottom: -14px; left: 5px; width: 1px; background: var(--sb-border); content: ""; }
.zhin-sandbox .agent-playground-inline-run-steps i { position: relative; z-index: 1; width: 10px; height: 10px; border: 2px solid var(--sb-bg); border-radius: var(--console-radius-full); background: var(--sb-primary); outline: var(--console-border-hairline) solid var(--sb-primary-line); outline-offset: calc(var(--console-border-hairline) * -1); }
.zhin-sandbox .agent-playground-inline-run-steps li.is-running i { background: var(--sb-info); animation: sandbox-breathe 1.4s ease-in-out infinite; }
.zhin-sandbox .agent-playground-inline-run-steps li.is-failed i, .zhin-sandbox .agent-playground-inline-run-steps li.is-denied i { background: var(--sb-danger); }
.zhin-sandbox .agent-playground-inline-run-steps li.is-cancelled i { background: var(--sb-warn); }
.zhin-sandbox .agent-playground-inline-run-steps li > div { display: flex; flex-direction: column; min-width: 0; }
.zhin-sandbox .agent-playground-inline-run-steps strong { overflow: hidden; font-size: var(--console-text-label); font-weight: var(--console-weight-strong); text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-inline-run-steps small { overflow: hidden; font-size: var(--console-text-label); color: var(--sb-muted-fg); text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-inline-run-steps li > span { font-size: var(--console-text-label); color: var(--sb-muted-fg); font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-inline-run-steps li.is-failed > span, .zhin-sandbox .agent-playground-inline-run-steps li.is-denied > span { color: var(--sb-danger); }
.zhin-sandbox .agent-playground-inline-run-empty { padding: var(--console-space-3) var(--console-space-4); font-size: var(--console-text-label); text-align: center; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-inline-run footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--console-space-2); padding: var(--console-space-2) var(--console-space-4) var(--console-space-2) var(--console-space-4); }
.zhin-sandbox .agent-playground-inline-run footer button:where(:not(.console-control, [data-state])) { min-height: 30px; padding: var(--console-space-1) var(--console-space-2); border: 0; background: transparent; color: var(--sb-muted-fg); font-size: var(--console-text-label); }
.zhin-sandbox .agent-playground-inline-run footer button:hover:not(:disabled):where(:not(.console-control, [data-state])) { color: var(--sb-primary); }
.zhin-sandbox .agent-playground-inline-run footer button:first-child:where(:not(.console-control, [data-state])) svg { transition: transform .15s ease; }
.zhin-sandbox .agent-playground-inline-run footer button:first-child[aria-expanded="true"]:where(:not(.console-control, [data-state])) svg { transform: rotate(180deg); }

/* ---------- Composer ---------- */
.zhin-sandbox .agent-playground-composer { position: relative; z-index: 2; display: grid; gap: var(--console-space-2); padding: var(--console-space-3) var(--console-space-4); border-top: 1px solid var(--sb-border-soft); background: var(--sb-bg); }
.zhin-sandbox .sandbox-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--console-space-2); }
.zhin-sandbox .sandbox-toolbar-spacer { flex: 1; min-width: 16px; }
.zhin-sandbox .sandbox-panel { display: grid; gap: var(--console-space-2); max-height: 256px; overflow-y: auto; padding: var(--console-space-3); border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-muted); }
.zhin-sandbox .sandbox-panel-hint { font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-face-grid { display: grid; grid-template-columns: repeat(8, minmax(0,1fr)); gap: var(--console-space-1); }
.zhin-sandbox .sandbox-face-button { width: 100%; min-width: 0; height: 40px; padding: 0; }
.zhin-sandbox .sandbox-face-img { width: 32px; height: 32px; }
.zhin-sandbox .sandbox-empty-hint { display: flex; flex-direction: column; align-items: center; gap: var(--console-space-2); padding: var(--console-space-3); font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-empty-hint > svg { opacity: .5; }
.zhin-sandbox .sandbox-editor-row { display: flex; align-items: flex-start; gap: var(--console-space-2); }
.zhin-sandbox .sandbox-editor-wrap { position: relative; flex: 1; min-width: 0; }
.zhin-sandbox [contenteditable="true"] { min-height: 44px; padding: var(--console-space-3) var(--console-space-3); background: var(--sb-muted); border: 1px solid var(--sb-input); border-radius: var(--console-radius-2); line-height: 1.6; overflow-y: auto; outline: none; }
.zhin-sandbox [contenteditable="true"]:focus-visible { border-color: var(--sb-ring); outline: 2px solid var(--sb-ring); outline-offset: 1px; }
.zhin-sandbox [contenteditable="true"]:empty::before { content: attr(data-placeholder); color: var(--sb-muted-fg); pointer-events: none; }
.zhin-sandbox .editor-face { width: 24px; height: 24px; display: inline-block; vertical-align: middle; }
.zhin-sandbox .editor-image { max-width: 100%; max-height: 100px; display: inline-block; vertical-align: middle; border-radius: var(--console-radius-1); }
.zhin-sandbox .editor-video, .zhin-sandbox .editor-audio, .zhin-sandbox .editor-at { display: inline-flex; align-items: center; margin: 0 var(--console-space-1); padding: 0 var(--console-space-2); border-radius: var(--console-radius-1); background: var(--sb-accent); font-size: var(--console-text-label); vertical-align: baseline; }
.zhin-sandbox .editor-at { color: var(--sb-primary); }
/* ADR 0064 D13 (I1): uploaded files in the composer, the upload list and the drop target. */
.zhin-sandbox img.editor-uploaded { max-width: min(200px, 100%); max-height: 100px; display: inline-block; vertical-align: middle; border-radius: var(--console-radius-1); }
.zhin-sandbox span.editor-uploaded { display: inline-flex; align-items: center; max-width: 100%; margin: 0 var(--console-space-1); padding: 0 var(--console-space-2); border-radius: var(--console-radius-1); background: var(--sb-accent); font-size: var(--console-text-label); vertical-align: baseline; overflow-wrap: anywhere; }
.zhin-sandbox .sandbox-editor-wrap.is-drag-active [contenteditable="true"] { border-color: var(--sb-ring); outline: 2px dashed var(--sb-ring); outline-offset: 1px; }
.zhin-sandbox .sandbox-file-input { display: none; }
.zhin-sandbox .sandbox-upload-list { display: flex; flex-direction: column; gap: var(--console-space-1); margin: 0 0 var(--console-space-2); padding: 0; list-style: none; }
.zhin-sandbox .sandbox-upload-item { display: flex; align-items: center; gap: var(--console-space-2); min-width: 0; color: var(--sb-muted-fg); font-size: var(--console-text-label); }
.zhin-sandbox .sandbox-upload-item.is-failed { color: var(--sb-danger); }
.zhin-sandbox .sandbox-upload-item > svg { flex-shrink: 0; }
.zhin-sandbox .sandbox-upload-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--console-weight-strong); }
.zhin-sandbox .sandbox-upload-state { min-width: 0; overflow-wrap: anywhere; }
.zhin-sandbox .sandbox-markdown-preview { min-height: 44px; max-height: 240px; padding: var(--console-space-3) var(--console-space-3); overflow: auto; background: var(--sb-muted); border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); }
.zhin-sandbox .sandbox-markdown-preview-empty { font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-at-popover { position: absolute; z-index: 50; min-width: 240px; max-height: 288px; overflow-y: auto; padding: var(--console-space-1); border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: hsl(var(--popover, 0 0% 100%)); box-shadow: var(--console-elevation-2); }
.zhin-sandbox .sandbox-at-item { display: flex; align-items: center; gap: var(--console-space-2); padding: var(--console-space-2); border-radius: var(--console-radius-1); cursor: pointer; }
.zhin-sandbox .sandbox-at-item:hover { background: var(--sb-accent); }
.zhin-sandbox .sandbox-at-item > svg { flex-shrink: 0; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-at-name { font-size: var(--console-text-label); font-weight: var(--console-weight-strong); }
.zhin-sandbox .sandbox-at-id { font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-hints { font-size: var(--console-text-label); line-height: 1.8; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-hints > summary { display: inline-flex; align-items: center; gap: var(--console-space-2); cursor: pointer; user-select: none; list-style: none; }
.zhin-sandbox .sandbox-hints > summary::-webkit-details-marker { display: none; }
.zhin-sandbox .sandbox-hints > summary:hover { color: var(--sb-fg); }
.zhin-sandbox .sandbox-hints > ul { display: flex; flex-wrap: wrap; gap: var(--console-space-1) var(--console-space-3); margin: var(--console-space-1) 0 0; padding: 0; list-style: none; }
.zhin-sandbox .sandbox-hints li { display: inline-flex; align-items: center; gap: var(--console-space-1); white-space: nowrap; }
.zhin-sandbox .sandbox-speaker-mode { display: grid; gap: var(--console-space-2); grid-column: 1 / -1; }
.zhin-sandbox .sandbox-speaker-toggle { display: inline-flex; align-items: center; gap: var(--console-space-2); font-weight: var(--console-weight-strong); }
.zhin-sandbox .sandbox-speaker-mode > p { margin: 0; color: var(--sb-muted-fg); font-size: var(--console-text-label); }
.zhin-sandbox .sandbox-speaker-setup { display: flex; flex-wrap: wrap; align-items: center; gap: var(--console-space-2); font-size: var(--console-text-label); }
.zhin-sandbox .sandbox-speaker-setup > em { font-style: normal; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-hint-key { padding: 0 var(--console-space-2); border: 1px solid var(--sb-border); border-radius: var(--console-radius-1); background: var(--sb-muted); color: var(--sb-fg); font-family: var(--sb-mono); font-size: var(--console-text-label); line-height: 1.4; }

/* ---------- Inspector ---------- */
.zhin-sandbox .agent-playground-inspector { position: absolute; right: 0; top: 0; bottom: 0; z-index: 30; display: flex; flex-direction: column; width: min(360px, 90%); min-width: 0; overflow-y: auto; background: var(--sb-sidebar); border-left: 1px solid var(--sb-border); box-shadow: var(--console-elevation-3); scrollbar-width: thin; }
.zhin-sandbox .agent-playground-inspector-head { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: var(--console-space-3); min-height: 68px; padding: var(--console-space-3) var(--console-space-4); border-bottom: 1px solid var(--sb-border-soft); }
.zhin-sandbox .agent-playground-inspector-head > div:last-child { display: flex; gap: var(--console-space-2); }
.zhin-sandbox .agent-playground-inspector-head > div:first-child > span { font-size: var(--console-text-label); font-weight: var(--console-weight-strong); letter-spacing: .04em; color: var(--sb-primary); }
.zhin-sandbox .agent-playground-inspector-head h2 { font-size: var(--console-text-section); font-weight: var(--console-weight-strong); }
.zhin-sandbox .agent-playground-inspector-head button:where(:not(.console-control, [data-state])) { width: 34px; padding: 0; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-inspector-view { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.zhin-sandbox .agent-playground-inspector-section { padding: var(--console-space-4); border-bottom: 1px solid var(--sb-border-soft); }
.zhin-sandbox .agent-playground-inspector-title { display: flex; align-items: center; justify-content: space-between; gap: var(--console-space-2); margin-bottom: var(--console-space-3); font-size: var(--console-text-label); font-weight: var(--console-weight-strong); }
.zhin-sandbox .agent-playground-inspector-title small { font-size: var(--console-text-label); font-weight: var(--console-weight-medium); letter-spacing: .03em; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-metrics { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); overflow: hidden; border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-bg); }
.zhin-sandbox .agent-playground-metrics > div { display: grid; grid-template-columns: auto 1fr; gap: var(--console-space-1) var(--console-space-2); min-width: 0; padding: var(--console-space-3); }
.zhin-sandbox .agent-playground-metrics > div:nth-child(odd) { border-right: 1px solid var(--sb-border); }
.zhin-sandbox .agent-playground-metrics > div:nth-child(-n+2) { border-bottom: 1px solid var(--sb-border); }
.zhin-sandbox .agent-playground-metrics svg { grid-row: span 2; width: 15px; height: 15px; color: var(--sb-primary); }
.zhin-sandbox .agent-playground-metrics strong { overflow: hidden; font-size: var(--console-text-section); font-weight: var(--console-weight-strong); font-variant-numeric: tabular-nums; text-overflow: ellipsis; }
.zhin-sandbox .agent-playground-metrics span { font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-metrics .has-problem svg, .zhin-sandbox .agent-playground-metrics .has-problem strong { color: var(--sb-danger); }
.zhin-sandbox .agent-playground-context-list { display: grid; }
.zhin-sandbox .agent-playground-context-list > div { display: flex; align-items: baseline; justify-content: space-between; gap: var(--console-space-3); min-width: 0; padding: var(--console-space-2) 0; border-bottom: 1px dashed var(--sb-border); font-size: var(--console-text-label); }
.zhin-sandbox .agent-playground-context-list > div:last-child { border-bottom: 0; }
.zhin-sandbox .agent-playground-context-list dt { flex-shrink: 0; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-context-list dd { min-width: 0; overflow: hidden; font-family: var(--sb-mono); text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-trace-section { flex: 1; }
.zhin-sandbox .agent-playground-trace-list { position: relative; display: grid; }
.zhin-sandbox .agent-playground-trace-list::before { position: absolute; top: 10px; bottom: 10px; left: 5px; width: 1px; background: var(--sb-border); content: ""; }
.zhin-sandbox .agent-playground-trace-item { position: relative; display: grid; grid-template-columns: 12px minmax(0,1fr) auto; align-items: start; gap: var(--console-space-2); padding: var(--console-space-2) 0; font-size: var(--console-text-label); }
.zhin-sandbox .agent-playground-trace-dot { position: relative; z-index: 1; width: 10px; height: 10px; margin-top: var(--console-space-1); border: 2px solid var(--sb-sidebar); border-radius: var(--console-radius-full); background: var(--sb-muted-fg); outline: var(--console-border-hairline) solid var(--sb-border); outline-offset: calc(var(--console-border-hairline) * -1); }
.zhin-sandbox .agent-playground-trace-item.is-success .agent-playground-trace-dot { background: var(--sb-ok); }
.zhin-sandbox .agent-playground-trace-item.is-running .agent-playground-trace-dot, .zhin-sandbox .agent-playground-trace-item.is-thinking .agent-playground-trace-dot { background: var(--sb-info); }
.zhin-sandbox .agent-playground-trace-item.is-tool .agent-playground-trace-dot, .zhin-sandbox .agent-playground-trace-item.is-usage .agent-playground-trace-dot { background: var(--sb-primary); }
.zhin-sandbox .agent-playground-trace-item.is-capability .agent-playground-trace-dot { background: var(--sb-warn); }
.zhin-sandbox .agent-playground-trace-item.is-problem .agent-playground-trace-dot { background: var(--sb-danger); }
.zhin-sandbox .agent-playground-trace-item > div { display: flex; flex-direction: column; min-width: 0; }
.zhin-sandbox .agent-playground-trace-item strong { overflow: hidden; font-size: var(--console-text-label); font-weight: var(--console-weight-strong); text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-trace-item small { overflow: hidden; font-size: var(--console-text-label); color: var(--sb-muted-fg); text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-trace-item time { margin-top: var(--console-space-1); font-size: var(--console-text-label); color: var(--sb-muted-fg); font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-trace-loading, .zhin-sandbox .agent-playground-trace-empty, .zhin-sandbox .agent-playground-trace-notice, .zhin-sandbox .agent-playground-artifact-empty { display: flex; align-items: center; justify-content: center; gap: var(--console-space-2); min-height: 80px; padding: var(--console-space-3); border: 1px dashed var(--sb-border); border-radius: var(--console-radius-2); font-size: var(--console-text-label); line-height: 1.5; text-align: center; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-artifact-empty { flex-direction: column; min-height: 104px; }
.zhin-sandbox .agent-playground-trace-notice { min-height: 0; margin-bottom: var(--console-space-3); border-color: var(--sb-warn-line); color: var(--sb-warn); }
.zhin-sandbox .agent-playground-trace-loading i { width: 6px; height: 6px; border-radius: var(--console-radius-full); background: var(--sb-primary); animation: sandbox-pulse .9s ease-in-out infinite alternate; }
.zhin-sandbox .agent-playground-trace-loading i:nth-child(2) { animation-delay: .15s; }
.zhin-sandbox .agent-playground-trace-loading i:nth-child(3) { animation-delay: .3s; }
.zhin-sandbox .agent-playground-task-section, .zhin-sandbox .agent-playground-artifact-section { flex: 0 0 auto; }
.zhin-sandbox .agent-playground-artifact-section { flex: 1 0 auto; }
.zhin-sandbox .agent-playground-task-list, .zhin-sandbox .agent-playground-artifact-list { display: grid; gap: var(--console-space-2); }
.zhin-sandbox .agent-playground-task-list article { display: grid; grid-template-columns: 10px minmax(0,1fr); gap: var(--console-space-1) var(--console-space-2); padding: var(--console-space-3); border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-bg); }
.zhin-sandbox .agent-playground-task-list article > i { width: 8px; height: 8px; margin-top: var(--console-space-2); border-radius: var(--console-radius-full); background: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-task-list article.is-running > i { background: var(--sb-info); }
.zhin-sandbox .agent-playground-task-list article.is-completed > i { background: var(--sb-ok); }
.zhin-sandbox .agent-playground-task-list article.is-failed > i { background: var(--sb-danger); }
.zhin-sandbox .agent-playground-task-list article.is-cancelled > i { background: var(--sb-warn); }
.zhin-sandbox .agent-playground-task-list article > div { display: flex; align-items: baseline; justify-content: space-between; gap: var(--console-space-2); min-width: 0; }
.zhin-sandbox .agent-playground-task-list strong { font-size: var(--console-text-label); font-weight: var(--console-weight-strong); }
.zhin-sandbox .agent-playground-task-list code { overflow: hidden; font-family: var(--sb-mono); font-size: var(--console-text-label); color: var(--sb-muted-fg); text-overflow: ellipsis; }
.zhin-sandbox .agent-playground-task-list dl { display: grid; grid-column: 2; grid-template-columns: repeat(3, minmax(0,1fr)); margin-top: var(--console-space-2); padding-top: var(--console-space-2); border-top: 1px dashed var(--sb-border); }
.zhin-sandbox .agent-playground-task-list dl > div { display: flex; flex-direction: column; }
.zhin-sandbox .agent-playground-task-list dt { font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-task-list dd { font-size: var(--console-text-label); font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-artifact-list article { overflow: hidden; border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-bg); }
.zhin-sandbox .agent-playground-artifact-list article.is-expanded { border-color: var(--sb-primary-line); }
.zhin-sandbox .agent-playground-artifact-list article > button:where(:not(.console-control, [data-state])) { display: grid; grid-template-columns: auto minmax(0,1fr) auto auto; gap: var(--console-space-2); align-items: center; width: 100%; padding: var(--console-space-2) var(--console-space-3); border: 0; border-radius: 0; background: transparent; text-align: left; }
.zhin-sandbox .agent-playground-artifact-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--sb-primary-line); border-radius: var(--console-radius-1); background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-artifact-list article > button:where(:not(.console-control, [data-state])) > span:nth-child(2) { display: flex; flex-direction: column; min-width: 0; }
.zhin-sandbox .agent-playground-artifact-list strong, .zhin-sandbox .agent-playground-artifact-list small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-artifact-list strong { font-size: var(--console-text-label); font-weight: var(--console-weight-strong); }
.zhin-sandbox .agent-playground-artifact-list small, .zhin-sandbox .agent-playground-artifact-list em { font-size: var(--console-text-label); font-style: normal; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-artifact-list article.is-completed em { color: var(--sb-ok); }
.zhin-sandbox .agent-playground-artifact-list article.is-failed em, .zhin-sandbox .agent-playground-artifact-list article.is-denied em { color: var(--sb-danger); }
.zhin-sandbox .agent-playground-artifact-list article > button:where(:not(.console-control, [data-state])) > svg { color: var(--sb-muted-fg); transition: transform .16s ease; }
.zhin-sandbox .agent-playground-artifact-list article.is-expanded > button:where(:not(.console-control, [data-state])) > svg { transform: rotate(180deg); }
.zhin-sandbox .agent-playground-artifact-detail { display: grid; gap: var(--console-space-2); padding: 0 var(--console-space-3) var(--console-space-3) var(--console-space-7); font-size: var(--console-text-label); }
.zhin-sandbox .agent-playground-artifact-detail > code { font-family: var(--sb-mono); font-size: var(--console-text-label); color: var(--sb-muted-fg); overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-artifact-detail pre { max-height: 240px; overflow: auto; padding: var(--console-space-3); border: 1px solid var(--sb-border); border-radius: var(--console-radius-1); background: var(--sb-muted); font-family: var(--sb-mono); font-size: var(--console-text-label); line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.zhin-sandbox .agent-playground-artifact-detail footer { display: flex; justify-content: space-between; gap: var(--console-space-2); color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-file-link { display: inline-flex; align-items: center; gap: var(--console-space-1); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-studio-link { display: flex; flex-shrink: 0; flex-direction: column; gap: var(--console-space-1); margin: var(--console-space-3); padding: var(--console-space-3) var(--console-space-3); border: 1px solid var(--sb-primary-line); border-radius: var(--console-radius-2); background: var(--sb-primary-soft); color: var(--sb-primary); font-size: var(--console-text-label); text-decoration: none; }
.zhin-sandbox .agent-playground-studio-link > span { display: flex; align-items: center; gap: var(--console-space-2); font-weight: var(--console-weight-strong); }
.zhin-sandbox .agent-playground-studio-link code { overflow: hidden; font-family: var(--sb-mono); font-size: var(--console-text-label); text-overflow: ellipsis; white-space: nowrap; opacity: .8; }

/* ---------- Animations ---------- */
@keyframes sandbox-spin { to { transform: rotate(360deg); } }
@keyframes sandbox-breathe { 0%, 100% { opacity: .5; transform: scale(.92); } 50% { opacity: 1; transform: scale(1); } }
@keyframes sandbox-pulse { from { opacity: .25; transform: translateY(1px); } to { opacity: 1; transform: translateY(-1px); } }

/* ---------- @zhin.js/console-ui components inside the workbench (ADR 0063 D13 step 2) ----------
 * Buttons, inputs, selects, switches, tabs, menus and dialogs come from the component library; the element
 * rules above skip them (:where(:not(.console-control, [data-state]))), so they keep the Console look.
 * Only layout lives here. */
.zhin-sandbox .agent-playground-section-label > :nth-child(3) { margin-left: auto; }
.zhin-sandbox .agent-playground-run-settings label.sandbox-speaker-toggle { flex: none; flex-direction: row; align-items: center; }
.zhin-sandbox .agent-playground-network-toggle { min-height: 36px; }
.zhin-sandbox .sandbox-block-button { width: 100%; }
.zhin-sandbox .sandbox-details-back { margin-bottom: var(--console-space-4); }
.zhin-sandbox .sandbox-alert { display: flex; flex: none; align-items: center; gap: var(--console-space-3); width: auto; margin: var(--console-space-3) var(--console-space-5) 0; }
.zhin-sandbox .sandbox-alert-copy { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.zhin-sandbox .sandbox-inspector-tabs { display: grid; flex-shrink: 0; grid-template-columns: 1fr 1.35fr; margin: var(--console-space-3) var(--console-space-3) 0; }
.zhin-sandbox .sandbox-inspector-tabs > * { gap: var(--console-space-2); min-width: 0; }
.zhin-sandbox .sandbox-tab-count { min-width: 18px; padding: 0 var(--console-space-2); border-radius: var(--console-radius-full); background: var(--sb-accent); color: var(--sb-muted-fg); font-size: var(--console-text-label); font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-inspector-head > div:last-child { gap: var(--console-space-1); }
.zhin-sandbox .agent-playground-approval-actions > div { display: flex; flex-wrap: wrap; gap: var(--console-space-2); }
.zhin-sandbox .agent-playground-inline-run-actions, .zhin-sandbox .agent-playground-inline-run footer { gap: var(--console-space-2); }
.zhin-sandbox .sandbox-editor-row > .console-control { flex-shrink: 0; align-self: flex-end; }
/* Inside the Console shell the page header sits above the workbench (ADR 0063 决策 2). */
.zhin-sandbox.agent-playground-shell.is-hosted { height: calc(100dvh - var(--console-header-h, 4.5rem) - var(--console-page-header-h) - var(--console-page-padding-block) - 1rem); }

/* ---------- Simulated sender, quick commands and rich cards ---------- */
.zhin-sandbox .sandbox-role-switcher { display: inline-flex; flex-wrap: wrap; gap: var(--console-space-1); }
.zhin-sandbox .sandbox-role-switcher > .sandbox-role-option { min-height: 32px; padding: var(--console-space-1) var(--console-space-3); border: 1px solid var(--sb-border); border-radius: var(--console-radius-1); background: transparent; color: inherit; font-size: var(--console-text-label); }
.zhin-sandbox .sandbox-role-switcher > .sandbox-role-option.active { border-color: var(--sb-primary-line); background: var(--sb-primary-soft); color: var(--sb-primary); font-weight: var(--console-weight-strong); }
.zhin-sandbox .sandbox-sender-presets { display: flex; flex-wrap: wrap; align-items: center; gap: var(--console-space-2); }
.zhin-sandbox .sandbox-quick-commands { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--console-space-1); margin-left: var(--console-space-2); }
.zhin-sandbox .sandbox-quick-commands > .sandbox-command-chip { min-height: 28px; gap: var(--console-space-1); padding: var(--console-space-1) var(--console-space-3); border: 1px solid var(--sb-border); border-radius: var(--console-radius-full); background: transparent; color: inherit; font-size: var(--console-text-label); }
.zhin-sandbox .sandbox-quick-commands > .sandbox-command-chip:hover:not(:disabled) { border-color: var(--sb-primary-line); background: var(--sb-primary-soft); }
.zhin-sandbox .sandbox-rich-card { max-width: 440px; margin-top: var(--console-space-2); overflow: hidden; border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-muted); }
.zhin-sandbox .sandbox-rich-card-image { display: block; width: 100%; max-height: 200px; object-fit: cover; }
.zhin-sandbox .sandbox-rich-card-body { display: flex; flex-direction: column; gap: var(--console-space-2); padding: var(--console-space-3) var(--console-space-3); }
.zhin-sandbox .sandbox-rich-card-title { font-size: var(--console-text-body); font-weight: var(--console-weight-strong); }
.zhin-sandbox .sandbox-rich-card-subtitle, .zhin-sandbox .sandbox-rich-card-field dt { font-size: var(--console-text-label); color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-rich-card-desc { font-size: var(--console-text-label); }
.zhin-sandbox .sandbox-rich-card-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--console-space-2); margin: var(--console-space-1) 0 0; }
.zhin-sandbox .sandbox-rich-card-field { padding: var(--console-space-1) var(--console-space-2); border-radius: var(--console-radius-1); background: var(--sb-bg); }
.zhin-sandbox .sandbox-rich-card-field dd { margin: 0; font-size: var(--console-text-label); font-weight: var(--console-weight-medium); }
.zhin-sandbox .sandbox-share-card { display: flex; align-items: center; gap: var(--console-space-3); max-width: 440px; margin-top: var(--console-space-2); padding: var(--console-space-2) var(--console-space-3); border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-muted); }
.zhin-sandbox .sandbox-share-card-thumb { flex-shrink: 0; width: 52px; height: 52px; border-radius: var(--console-radius-1); object-fit: cover; }
.zhin-sandbox .sandbox-share-card-main { display: flex; flex: 1; flex-direction: column; gap: var(--console-space-1); min-width: 0; }
.zhin-sandbox .sandbox-share-card-title { font-size: var(--console-text-label); font-weight: var(--console-weight-strong); }
.zhin-sandbox .sandbox-share-card-desc, .zhin-sandbox .sandbox-share-card-url { overflow: hidden; color: var(--sb-muted-fg); font-size: var(--console-text-label); text-overflow: ellipsis; }
.zhin-sandbox .sandbox-share-card-url { white-space: nowrap; }
.zhin-sandbox .sandbox-share-card:has(.sandbox-share-card-audio) { flex-direction: column; align-items: stretch; }
.zhin-sandbox .sandbox-share-card-row { display: flex; align-items: center; gap: var(--console-space-3); min-width: 0; }
.zhin-sandbox .sandbox-share-card-link { color: inherit; text-decoration: none; }
.zhin-sandbox .sandbox-share-card-link:hover { text-decoration: underline; }
.zhin-sandbox .sandbox-share-card-audio { display: block; width: 100%; height: 36px; }

/* ---------- ADR 0064: file / link / QR code / TTS segments ---------- */
.zhin-sandbox .sandbox-file-card { display: flex; align-items: center; gap: var(--console-space-3); max-width: 440px; margin-top: var(--console-space-2); padding: var(--console-space-2) var(--console-space-3); border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-muted); }
.zhin-sandbox .sandbox-file-card-icon { flex-shrink: 0; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-file-card-main { display: flex; flex: 1; flex-direction: column; gap: var(--console-space-1); min-width: 0; }
.zhin-sandbox .sandbox-file-card-name { overflow: hidden; font-size: var(--console-text-label); font-weight: var(--console-weight-strong); text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .sandbox-file-card-meta { color: var(--sb-muted-fg); font-size: var(--console-text-label); }
.zhin-sandbox .sandbox-file-card-download { display: inline-flex; flex-shrink: 0; align-items: center; gap: var(--console-space-1); min-height: 32px; padding: 0 var(--console-space-2); border-radius: var(--console-radius-1); color: var(--sb-primary); font-size: var(--console-text-label); text-decoration: none; }
.zhin-sandbox .sandbox-file-card-download:hover { background: var(--sb-primary-soft); }
.zhin-sandbox .sandbox-link-card { display: inline-flex; align-items: center; gap: var(--console-space-2); max-width: 100%; margin: var(--console-space-1) 0; padding: var(--console-space-1) var(--console-space-3); border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-muted); color: var(--sb-primary); font-size: var(--console-text-label); text-decoration: none; }
.zhin-sandbox .sandbox-link-card:hover { border-color: var(--sb-primary-line); }
.zhin-sandbox .sandbox-link-card.is-inert { color: inherit; }
.zhin-sandbox .sandbox-link-card-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .sandbox-link-card-host { flex-shrink: 0; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-qrcode { display: inline-flex; flex-direction: column; align-items: center; gap: var(--console-space-2); max-width: 240px; margin: var(--console-space-2) 0 0; padding: var(--console-space-3); border: 1px solid var(--sb-border); border-radius: var(--console-radius-2); background: var(--sb-muted); }
.zhin-sandbox .sandbox-qrcode-image { display: block; width: 180px; max-width: 100%; height: auto; }
/* A QR code is read by cameras: dark modules on a light field in every theme. */
.zhin-sandbox .sandbox-qrcode-light { fill: #fff; }
.zhin-sandbox .sandbox-qrcode-dark { fill: #000; }
.zhin-sandbox .sandbox-qrcode-text { max-width: 100%; overflow-wrap: anywhere; color: var(--sb-muted-fg); font-size: var(--console-text-label); text-align: center; }
.zhin-sandbox .sandbox-qrcode-error { font-size: var(--console-text-label); }
.zhin-sandbox .sandbox-tts { display: flex; flex-wrap: wrap; align-items: center; gap: var(--console-space-2); margin-top: var(--console-space-1); }
.zhin-sandbox .sandbox-tts-text { min-width: 0; overflow-wrap: anywhere; }
.zhin-sandbox .sandbox-action-feedback { display: flex; align-items: flex-start; gap: var(--console-space-1); margin: var(--console-space-1) 0 0; color: var(--sb-muted-fg); font-size: var(--console-text-label); overflow-wrap: anywhere; }
.zhin-sandbox .sandbox-action-feedback.is-error { color: var(--sb-danger); }
.zhin-sandbox .sandbox-action-feedback > svg { flex-shrink: 0; margin-top: calc(var(--console-space-1) / 2); }
.zhin-sandbox .sandbox-reactions { display: flex; flex-wrap: wrap; gap: var(--console-space-1); margin-top: var(--console-space-1); }
.zhin-sandbox .sandbox-reaction { display: inline-flex; align-items: center; min-height: 24px; padding: 0 var(--console-space-2); border: 1px solid var(--sb-border); border-radius: var(--console-radius-full); background: var(--sb-muted); font-size: var(--console-text-label); }
.zhin-sandbox .im-markdown-image { display: inline-block; max-width: 100%; max-height: 320px; vertical-align: middle; border-radius: var(--console-radius-1); }
.zhin-sandbox .im-markdown-list .im-markdown-list { margin-top: var(--console-space-1); list-style: circle; }
.zhin-sandbox .im-markdown-list .im-markdown-list .im-markdown-list { list-style: square; }
.zhin-sandbox .im-markdown-list .im-markdown-list-ordered { list-style: lower-alpha; }

/* ---------- Responsive ---------- */
@media (width >= 64rem) {
  .zhin-sandbox .agent-playground-mobilebar { display: none; }
}
/* Below 64rem (Console lg) the conversation list is a drawer (workspace styles); the bar holds its toggle. */
@media (width < 64rem) {
  .zhin-sandbox .agent-playground-mobilebar { display: flex; align-items: center; justify-content: space-between; gap: var(--console-space-2); padding: var(--console-space-2) var(--console-space-3); border-bottom: 1px solid var(--sb-border); background: var(--sb-bg); }
  /* One column: the list is a drawer and the inspector an overlay (the workspace styles place the bar and main). */
  .zhin-sandbox.agent-playground-shell, .zhin-sandbox.agent-playground-shell.has-inspector { grid-template-columns: minmax(0,1fr); grid-template-rows: auto minmax(0,1fr); }
  /* The drawer stays inside the workbench and never covers the Console shell (D19). */
  .zhin-sandbox .agent-playground-sessions.channel-sidebar { position: absolute; z-index: 40; height: auto; }
  .zhin-sandbox .channel-overlay { position: absolute; z-index: 35; }
}
/* Phones: every control of the workbench is at least 44px tall (D18 第 7 条 / D19). */
@media (width < 48rem) {
  .zhin-sandbox .sandbox-quick-commands > .sandbox-command-chip, .zhin-sandbox .sandbox-role-switcher > .sandbox-role-option { min-height: 44px; }
  .zhin-sandbox [role="tablist"] { height: auto; }
  .zhin-sandbox [role="tab"] { min-height: 44px; }
  .zhin-sandbox .agent-playground-network-toggle, .zhin-sandbox .agent-playground-run-settings label.sandbox-speaker-toggle { min-height: 44px; }
}
@media (width >= 90rem) {
  .zhin-sandbox.agent-playground-shell.has-inspector { grid-template-rows: minmax(0, 1fr); }
  .zhin-sandbox .agent-playground-inspector { min-height: 0; }
}
@media (width >= 90rem) {
  .zhin-sandbox.agent-playground-shell.has-inspector { grid-template-columns: 232px minmax(0,1fr) 330px; }
  .zhin-sandbox .agent-playground-inspector { position: static; width: auto; box-shadow: none; }
}
@media (width < 90rem) {
  .zhin-sandbox .agent-playground-inspector-overlay { display: block; position: absolute; inset: 0; z-index: 25; background: var(--sb-overlay); }
}
@media (width < 64rem) {
  .zhin-sandbox .agent-playground-inline-run-metrics { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .zhin-sandbox .agent-playground-inline-run-metrics > div:nth-child(3) { border-right: 0; }
  .zhin-sandbox .agent-playground-inline-run-metrics > div:nth-child(n+4) { border-top: 1px solid var(--sb-border); }
}
@media (width < 48rem) {
  .zhin-sandbox.agent-playground-shell { grid-template-columns: minmax(0,1fr); grid-template-rows: auto minmax(0,1fr); height: calc(100dvh - 92px); min-height: 480px; border-radius: var(--console-radius-2); }
  .zhin-sandbox button:where(:not(.console-control, [data-state])), .zhin-sandbox .agent-playground-run-actions > a:where(:not(.console-control, [data-state])) { min-height: 44px; min-width: 44px; }
  .zhin-sandbox :where(input:not([type="checkbox"]), select):where(:not(.console-control, [data-state])) { min-height: 44px; font-size: var(--console-text-section); }
  .zhin-sandbox .agent-playground-network-toggle { min-height: 44px; }
  .zhin-sandbox .agent-playground-sessions { display: none; position: absolute; inset: 0 auto 0 0; z-index: 40; width: min(300px, 88%); box-shadow: var(--console-elevation-3); }
  .zhin-sandbox .agent-playground-sessions.show { display: flex; }
  .zhin-sandbox .channel-overlay { display: block; position: absolute; inset: 0; z-index: 35; background: var(--sb-overlay); }
  .zhin-sandbox .agent-playground-runbar { flex-direction: column; align-items: flex-start; gap: var(--console-space-3); min-height: 0; padding: var(--console-space-3); }
  /* In a column the 14rem flex-basis would become the identity row height. */
  .zhin-sandbox .agent-playground-run-identity { flex: 0 0 auto; width: 100%; }
  .zhin-sandbox .agent-playground-run-actions { flex-wrap: wrap; justify-content: flex-start; margin-left: 0; max-width: 100%; }
  .zhin-sandbox .agent-playground-run-actions > a:where(:not(.console-control, [data-state])), .zhin-sandbox .agent-playground-run-actions > button:where(:not(.console-control, [data-state])) { flex-shrink: 0; white-space: nowrap; width: auto; font-size: var(--console-text-label); }
  .zhin-sandbox .agent-playground-run-title span { display: none; }
  .zhin-sandbox .agent-playground-message-scroll { padding: var(--console-space-4) var(--console-space-3); }
  .zhin-sandbox .agent-playground-message-main { max-width: calc(100% - 40px); }
  .zhin-sandbox .agent-playground-message.is-user .agent-playground-message-main { max-width: 86%; }
  .zhin-sandbox .agent-playground-message-content { padding: var(--console-space-2) var(--console-space-3); }
  .zhin-sandbox .agent-playground-composer { padding: var(--console-space-3) var(--console-space-3); }
  .zhin-sandbox .sandbox-toolbar-spacer { display: none; }
  .zhin-sandbox .sandbox-face-grid { grid-template-columns: repeat(6, minmax(0,1fr)); }
  .zhin-sandbox .sandbox-face-button { height: 44px; }
  .zhin-sandbox .sandbox-hints { display: none; }
  .zhin-sandbox .agent-playground-run-settings { max-height: 256px; overflow-y: auto; padding: var(--console-space-3); }
  .zhin-sandbox .agent-playground-empty { padding: var(--console-space-5) 0; }
  .zhin-sandbox .agent-playground-prompts { grid-template-columns: 1fr; }
  .zhin-sandbox .agent-playground-inline-run { margin-left: 0; }
  .zhin-sandbox .agent-playground-inline-run-head { grid-template-columns: auto minmax(0,1fr); }
  .zhin-sandbox .agent-playground-inline-run-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .zhin-sandbox .agent-playground-scope-picker button:where(:not(.console-control, [data-state])), .zhin-sandbox .agent-playground-section-label button:where(:not(.console-control, [data-state])), .zhin-sandbox .agent-playground-inline-run-actions button:where(:not(.console-control, [data-state])), .zhin-sandbox .agent-playground-inline-run footer button:where(:not(.console-control, [data-state])), .zhin-sandbox .zhin-code-actions button:where(:not(.console-control, [data-state])), .zhin-sandbox .zhin-code-expand, .zhin-sandbox .agent-playground-history-navigation button:where(:not(.console-control, [data-state])), .zhin-sandbox .agent-playground-inspector-head button:where(:not(.console-control, [data-state])) { min-height: 44px; min-width: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .zhin-sandbox *, .zhin-sandbox *::before, .zhin-sandbox *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;
