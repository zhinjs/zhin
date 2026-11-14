/**
 * The Sandbox workbench owns its complete presentation. Every colour derives from the Console theme tokens
 * (`--background`, `--primary`, ...) with a light fallback so the page also renders outside the Console, and
 * nothing here relies on Tailwind utilities or on the shared adapter-console stylesheet being injected first.
 * Rules: no hex literals, no gradients, no text below 12px, tap targets of at least 44px under 768px.
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
  --sb-radius-sm: var(--console-radius-sm, 6px);
  --sb-radius-md: var(--console-radius-md, 10px);
  --sb-radius-lg: var(--console-radius-lg, 14px);
  --sb-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'PingFang SC', monospace;
  color: var(--sb-fg);
  font-family: 'Avenir Next', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  text-align: left;
}
.zhin-sandbox *, .zhin-sandbox *::before, .zhin-sandbox *::after { box-sizing: border-box; }
.zhin-sandbox :where(h1, h2, h3, h4, h5, h6, p, ul, ol, dl, dd, figure, pre) { margin: 0; }
.zhin-sandbox :where(button, input, select, textarea) { font: inherit; color: inherit; }
.zhin-sandbox :where(a) { color: var(--sb-primary); text-underline-offset: 3px; overflow-wrap: anywhere; }
.zhin-sandbox :where(button, a, input, select, textarea, summary):focus-visible { outline: 2px solid var(--sb-ring); outline-offset: 2px; }
.zhin-sandbox [hidden] { display: none !important; }

/* ---------- Shell ---------- */
.zhin-sandbox.agent-playground-shell { position: relative; display: grid; grid-template-columns: 232px minmax(0,1fr); width: 100%; height: calc(100dvh - 72px); min-height: 520px; overflow: hidden; isolation: isolate; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-lg); background: var(--sb-bg); }

/* ---------- Shared controls ---------- */
.zhin-sandbox button { display: inline-flex; justify-content: center; align-items: center; gap: 7px; min-height: 34px; padding: 6px 10px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-sm); background: var(--sb-bg); color: var(--sb-fg); font-size: 13px; line-height: 1.4; cursor: pointer; transition: background-color .16s ease, border-color .16s ease, color .16s ease; }
.zhin-sandbox button:hover:not(:disabled) { background: var(--sb-accent); }
.zhin-sandbox button:disabled { opacity: .5; cursor: not-allowed; }
.zhin-sandbox button.primary, .zhin-sandbox .sandbox-send, .zhin-sandbox .sandbox-submit { background: var(--sb-primary); color: var(--sb-primary-fg); border-color: var(--sb-primary); }
.zhin-sandbox button.primary:hover:not(:disabled), .zhin-sandbox .sandbox-send:hover:not(:disabled), .zhin-sandbox .sandbox-submit:hover:not(:disabled) { background: var(--sb-primary); opacity: .9; }
.zhin-sandbox button.danger { background: var(--sb-danger); color: var(--sb-danger-fg); border-color: var(--sb-danger); }
.zhin-sandbox button.danger:hover:not(:disabled) { background: var(--sb-danger); opacity: .9; }
.zhin-sandbox :where(input:not([type="checkbox"]), select) { width: 100%; min-width: 0; min-height: 34px; padding: 6px 10px; border: 1px solid var(--sb-input); border-radius: var(--sb-radius-sm); background: var(--sb-bg); color: var(--sb-fg); font-size: 13px; line-height: 1.5; }
.zhin-sandbox :where(input, select):disabled { opacity: .6; cursor: not-allowed; background: var(--sb-muted); }
.zhin-sandbox :where(input)::placeholder { color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-input { width: 100%; }
.zhin-sandbox .is-spinning { animation: sandbox-spin 1s linear infinite; }

/* ---------- Mobile bar and overlays (hidden on wide screens) ---------- */
.zhin-sandbox .agent-playground-mobilebar { display: none; }
.zhin-sandbox .agent-playground-inspector-overlay, .zhin-sandbox .channel-overlay { display: none; }

/* ---------- Sessions sidebar ---------- */
.zhin-sandbox .agent-playground-sessions { min-width: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--sb-sidebar); border-right: 1px solid var(--sb-border); }
.zhin-sandbox .agent-playground-brand { padding: 20px 16px 16px; border-bottom: 1px solid var(--sb-border-soft); }
.zhin-sandbox .agent-playground-brand > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.zhin-sandbox .agent-playground-brand > div > div { display: flex; align-items: center; gap: 10px; min-width: 0; }
.zhin-sandbox .agent-playground-brand h2 { font-size: 15px; font-weight: 700; letter-spacing: -.02em; }
.zhin-sandbox .agent-playground-brand small { display: block; font-size: 12px; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-mark, .zhin-sandbox .agent-playground-empty-mark { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--sb-primary); background: var(--sb-primary-soft); }
.zhin-sandbox .agent-playground-mark { width: 32px; height: 32px; border: 1px solid var(--sb-primary-line); border-radius: var(--sb-radius-md); }
.zhin-sandbox .agent-playground-connection { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 28px; height: 28px; border: 1px solid var(--sb-border); border-radius: 999px; background: var(--sb-bg); color: var(--sb-warn); }
.zhin-sandbox .agent-playground-connection.is-online { color: var(--sb-ok); border-color: var(--sb-primary-line); }
.zhin-sandbox .is-online { color: var(--sb-ok); }
.zhin-sandbox .agent-playground-section-label { display: flex; align-items: center; gap: 8px; padding: 12px 14px 6px 16px; font-size: 12px; font-weight: 600; letter-spacing: .04em; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-section-label span:nth-child(2) { font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-section-label button { margin-left: auto; min-height: 28px; min-width: 28px; padding: 4px; background: transparent; border-color: transparent; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-session-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 10px; scrollbar-width: thin; }
.zhin-sandbox .agent-playground-session { position: relative; width: 100%; justify-content: flex-start; gap: 10px; margin: 2px 0; padding: 9px 10px; border: 0; border-radius: var(--sb-radius-md); background: transparent; text-align: left; }
.zhin-sandbox .agent-playground-session:hover:not(:disabled) { background: var(--sb-bg); }
.zhin-sandbox .agent-playground-session.active { background: var(--sb-bg); box-shadow: inset 2px 0 var(--sb-primary); }
.zhin-sandbox .agent-playground-session-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 32px; height: 32px; border-radius: var(--sb-radius-md); background: var(--sb-muted); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-session.active .agent-playground-session-icon { background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-session-copy { flex: 1; min-width: 0; }
.zhin-sandbox .agent-playground-session-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-session-scope { margin-top: 2px; font-size: 12px; color: var(--sb-muted-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-unread { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--sb-danger); color: var(--sb-danger-fg); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-new-session { padding: 10px 12px; border-top: 1px solid var(--sb-border-soft); }
.zhin-sandbox .agent-playground-add { width: 100%; min-height: 36px; border: 1px dashed var(--sb-primary-line); background: var(--sb-primary-soft); color: var(--sb-primary); font-weight: 600; }
.zhin-sandbox .agent-playground-add:hover:not(:disabled) { border-style: solid; background: var(--sb-primary-soft); }
.zhin-sandbox .agent-playground-new-form { display: grid; gap: 8px; }
.zhin-sandbox .agent-playground-scope-picker { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 3px; border-radius: var(--sb-radius-md); background: var(--sb-muted); }
.zhin-sandbox .agent-playground-scope-picker button { min-height: 30px; padding: 4px; border: 0; background: transparent; color: var(--sb-muted-fg); font-size: 12px; }
.zhin-sandbox .agent-playground-scope-picker button.active { background: var(--sb-bg); color: var(--sb-fg); box-shadow: 0 1px 4px var(--sb-shadow); }
.zhin-sandbox .agent-playground-new-actions { display: flex; justify-content: flex-end; gap: 6px; }
.zhin-sandbox .agent-playground-endpoint { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding: 10px 16px 12px; border-top: 1px solid var(--sb-border-soft); font-size: 12px; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-endpoint strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--sb-mono); font-size: 12px; font-weight: 500; color: var(--sb-fg); }

/* ---------- Main column: run bar ---------- */
.zhin-sandbox .agent-playground-main { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; background: var(--sb-bg); }
.zhin-sandbox .agent-playground-runbar { display: flex; flex-shrink: 0; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 16px; min-height: 68px; padding: 12px 20px; border-bottom: 1px solid var(--sb-border-soft); }
.zhin-sandbox .agent-playground-run-identity { display: flex; flex: 1 1 14rem; align-items: center; gap: 10px; min-width: 0; }
.zhin-sandbox .agent-playground-run-identity > div { flex: 1; min-width: 0; }
.zhin-sandbox .agent-playground-run-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 36px; height: 36px; border: 1px solid var(--sb-primary-line); border-radius: var(--sb-radius-md); background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-run-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.zhin-sandbox .agent-playground-run-title h1 { min-width: 0; max-width: 100%; overflow: hidden; font-size: 16px; font-weight: 700; letter-spacing: -.02em; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-run-title span { flex-shrink: 0; padding: 1px 8px; border: 1px solid var(--sb-border); border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-run-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; max-width: 100%; margin-left: auto; }
.zhin-sandbox .agent-playground-run-actions > a { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 6px 10px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-sm); color: var(--sb-muted-fg); font-size: 13px; text-decoration: none; }
.zhin-sandbox .agent-playground-run-actions > a:hover { background: var(--sb-accent); color: var(--sb-fg); }
.zhin-sandbox .agent-playground-run-actions > button { color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-run-actions > button:hover:not(:disabled) { border-color: var(--sb-primary-line); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-run-actions > button.active { border-color: var(--sb-primary-line); background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-run-actions > .agent-playground-stop { background: var(--sb-danger-soft); border-color: var(--sb-danger-line); color: var(--sb-danger); }
.zhin-sandbox .agent-playground-run-actions > .agent-playground-stop:hover:not(:disabled) { background: var(--sb-danger-soft); border-color: var(--sb-danger); color: var(--sb-danger); }
.zhin-sandbox .agent-playground-run-state { display: inline-flex; align-items: center; gap: 6px; margin-right: 4px; color: var(--sb-muted-fg); font-size: 13px; white-space: nowrap; }
.zhin-sandbox .agent-playground-run-state.is-running { color: var(--sb-primary); }
.zhin-sandbox .agent-playground-run-state.is-running svg { animation: sandbox-breathe 1.5s ease-in-out infinite; }
.zhin-sandbox .agent-playground-run-state.has-problem { color: var(--sb-danger); }

/* ---------- Banners and run settings ---------- */
.zhin-sandbox .agent-playground-confirm { display: flex; align-items: center; gap: 8px 10px; padding: 10px 20px; border-bottom: 1px solid var(--sb-danger-line); background: var(--sb-danger-soft); color: var(--sb-fg); font-size: 13px; }
.zhin-sandbox .agent-playground-confirm > div { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-confirm > div > span { color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-confirm button { min-height: 32px; padding: 4px 12px; background: var(--sb-bg); }
.zhin-sandbox .sandbox-notice { display: flex; align-items: flex-start; gap: 8px; padding: 8px 20px; border-bottom: 1px solid var(--sb-warn-line); background: var(--sb-warn-soft); color: var(--sb-fg); font-size: 13px; }
.zhin-sandbox .sandbox-notice > svg { flex-shrink: 0; margin-top: 3px; color: var(--sb-warn); }
.zhin-sandbox .sandbox-notice > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.zhin-sandbox .sandbox-notice button { min-height: 28px; padding: 2px 10px; background: transparent; }
.zhin-sandbox .agent-playground-run-settings { position: relative; z-index: 3; display: flex; flex-wrap: wrap; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--sb-border-soft); background: var(--sb-sidebar); }
.zhin-sandbox .agent-playground-run-settings label { display: flex; flex: 1 1 140px; flex-direction: column; gap: 5px; min-width: 0; }
.zhin-sandbox .agent-playground-run-settings .agent-playground-directory-field { flex-basis: 100%; }
.zhin-sandbox .agent-playground-run-settings label > span { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-run-settings > p { display: flex; flex-basis: 100%; align-items: flex-start; gap: 6px; font-size: 12px; color: var(--sb-warn); }
.zhin-sandbox .agent-playground-run-settings > p > svg { flex-shrink: 0; margin-top: 3px; }
.zhin-sandbox .agent-playground-network-toggle { position: relative; flex: none !important; flex-direction: row !important; align-items: center; gap: 10px !important; }
.zhin-sandbox .agent-playground-network-toggle input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.zhin-sandbox .agent-playground-network-toggle i { position: relative; display: block; width: 36px; height: 20px; border: 1px solid var(--sb-input); border-radius: 999px; background: var(--sb-muted); cursor: pointer; transition: background-color .16s ease, border-color .16s ease; }
.zhin-sandbox .agent-playground-network-toggle i::after { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--sb-bg); box-shadow: 0 1px 3px var(--sb-shadow); content: ""; transition: transform .16s ease; }
.zhin-sandbox .agent-playground-network-toggle input:checked + i { border-color: var(--sb-primary); background: var(--sb-primary); }
.zhin-sandbox .agent-playground-network-toggle input:checked + i::after { transform: translateX(16px); }
.zhin-sandbox .agent-playground-network-toggle input:disabled + i { opacity: .6; cursor: not-allowed; }
.zhin-sandbox .agent-playground-network-toggle input:focus-visible + i { outline: 2px solid var(--sb-ring); outline-offset: 2px; }

/* ---------- Conversation ---------- */
.zhin-sandbox .agent-playground-conversation { position: relative; flex: 1; display: flex; min-height: 0; overflow: hidden; }
.zhin-sandbox .agent-playground-message-scroll { flex: 1; min-width: 0; height: 100%; overflow-y: auto; overscroll-behavior: contain; padding: 24px 20px; scrollbar-gutter: stable; scrollbar-width: thin; }
.zhin-sandbox .agent-playground-conversation-details { flex: 1; min-height: 0; overflow: auto; padding: 16px; }
.zhin-sandbox .agent-playground-details-back { margin-bottom: 12px; border-color: transparent; background: transparent; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-history-navigation, .zhin-sandbox .agent-playground-history-notice { padding: 8px 16px; font-size: 12px; text-align: center; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-history-navigation p[role=alert] { color: var(--sb-danger); overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-history-navigation button { min-height: 32px; border-color: transparent; background: transparent; color: var(--sb-primary); }
.zhin-sandbox .agent-playground-empty { display: grid; width: min(100%, 42rem); min-height: 100%; align-content: center; margin: 0 auto; padding: 32px 0; text-align: center; }
.zhin-sandbox .agent-playground-empty-mark { width: 56px; height: 56px; margin: 0 auto 18px; border: 1px solid var(--sb-primary-line); border-radius: var(--sb-radius-lg); }
.zhin-sandbox .agent-playground-empty h2 { font-size: clamp(18px, 2.2vw, 24px); font-weight: 700; letter-spacing: -.025em; margin-bottom: 8px; }
.zhin-sandbox .agent-playground-empty p { max-width: 48ch; margin: 0 auto; color: var(--sb-muted-fg); font-size: 14px; line-height: 1.7; }
.zhin-sandbox .agent-playground-prompts { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px; margin-top: 22px; }
.zhin-sandbox .agent-playground-prompts button { flex-direction: column; align-items: flex-start; justify-content: flex-start; min-height: 64px; padding: 12px; border-radius: var(--sb-radius-md); font-size: 13px; text-align: left; }
.zhin-sandbox .agent-playground-prompts button::after { margin-top: auto; color: var(--sb-primary); content: "\\2197"; }
.zhin-sandbox .agent-playground-prompts button:hover:not(:disabled) { border-color: var(--sb-primary-line); background: var(--sb-muted); }
.zhin-sandbox .agent-playground-message-list { display: flex; flex-direction: column; gap: 18px; width: min(100%, 52rem); margin: 0 auto; padding-bottom: 12px; }
.zhin-sandbox .agent-playground-message { display: flex; align-items: flex-start; gap: 10px; }
.zhin-sandbox .agent-playground-message.is-user { flex-direction: row-reverse; }
.zhin-sandbox .agent-playground-message-avatar { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 30px; height: 30px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-md); background: var(--sb-muted); color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-message.is-agent .agent-playground-message-avatar { border-color: var(--sb-primary-line); background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-message-main { min-width: 0; max-width: calc(100% - 44px); }
.zhin-sandbox .agent-playground-message.is-user .agent-playground-message-main { max-width: min(76%, 42rem); }
.zhin-sandbox .agent-playground-message-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; margin: 0 2px 4px; font-size: 12px; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-message.is-user .agent-playground-message-meta { justify-content: flex-end; }
.zhin-sandbox .agent-playground-message-meta strong { font-weight: 650; color: var(--sb-fg); }
.zhin-sandbox .agent-playground-message-meta span { color: var(--sb-warn); }
.zhin-sandbox .agent-playground-message-content { min-width: 0; padding: 10px 14px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-lg); background: var(--sb-bg); line-height: 1.7; overflow-wrap: anywhere; overflow: hidden; }
.zhin-sandbox .agent-playground-message-content img { max-width: 100%; border-radius: var(--sb-radius-md); }
.zhin-sandbox .agent-playground-message-content > :first-child { margin-top: 0; }
.zhin-sandbox .agent-playground-message-content > :last-child { margin-bottom: 0; }
.zhin-sandbox .agent-playground-message.is-user .agent-playground-message-content { border-color: var(--sb-primary-line); background: var(--sb-primary-soft); }
.zhin-sandbox .agent-playground-message.is-approval .agent-playground-message-avatar { border-color: var(--sb-warn-line); background: var(--sb-warn-soft); color: var(--sb-warn); }
.zhin-sandbox .agent-playground-message.is-approval .agent-playground-message-content { border-color: var(--sb-warn-line); background: var(--sb-warn-soft); }
.zhin-sandbox .agent-playground-message.is-approval .agent-playground-message-meta span:last-of-type { padding: 0 8px; border: 1px solid var(--sb-warn-line); border-radius: 999px; font-weight: 600; }
.zhin-sandbox .agent-playground-approval-actions { display: grid; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--sb-warn-line); }
.zhin-sandbox .agent-playground-approval-actions > div { display: flex; flex-wrap: wrap; gap: 6px; }
.zhin-sandbox .agent-playground-approval-actions button { min-height: 34px; font-weight: 600; }
.zhin-sandbox .agent-playground-approval-actions button.is-primary { background: var(--sb-primary); border-color: var(--sb-primary); color: var(--sb-primary-fg); }
.zhin-sandbox .agent-playground-approval-actions button.is-danger { background: var(--sb-danger-soft); border-color: var(--sb-danger-line); color: var(--sb-danger); }
.zhin-sandbox .agent-playground-approval-actions small { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--sb-primary); }

/* ---------- Message segments (formerly Tailwind utilities) ---------- */
.zhin-sandbox .sandbox-chip { display: inline-flex; align-items: center; margin: 0 2px; padding: 1px 6px; border-radius: var(--sb-radius-sm); background: var(--sb-muted); color: var(--sb-fg); font-size: 12px; }
.zhin-sandbox .sandbox-chip.is-mention { background: var(--sb-accent); }
.zhin-sandbox .sandbox-inline-face { display: inline-block; width: 24px; height: 24px; margin: 0 2px; vertical-align: middle; }
.zhin-sandbox .sandbox-segment-note { font-size: 12px; opacity: .8; }
.zhin-sandbox .sandbox-media-link { display: block; margin: 4px 0; }
.zhin-sandbox .sandbox-media-image { display: block; max-width: min(320px, 88%); border: 1px solid var(--sb-border); border-radius: var(--sb-radius-md); }
.zhin-sandbox .sandbox-media-video { display: block; max-width: min(360px, 92%); max-height: 288px; margin: 4px 0; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-md); background: var(--sb-muted); }
.zhin-sandbox .sandbox-media-audio { display: block; width: 100%; max-width: 384px; height: 40px; margin: 8px 0; }
.zhin-sandbox .sandbox-html-frame { display: block; width: 100%; min-width: 0; margin: 4px 0; border: 0; border-radius: var(--sb-radius-md); background: transparent; }
.zhin-sandbox .sandbox-reply-quote { margin-bottom: 4px; padding: 2px 8px; border: 1px dashed var(--sb-input); border-radius: var(--sb-radius-sm); font-size: 12px; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-forward { display: grid; gap: 4px; margin: 4px 0; padding: 8px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-sm); background: var(--sb-muted); font-size: 12px; }
.zhin-sandbox .sandbox-forward-title { font-weight: 600; }
.zhin-sandbox .sandbox-forward-list { display: grid; gap: 4px; padding-left: 8px; border-left: 2px solid var(--sb-border); }
.zhin-sandbox .sandbox-forward-more, .zhin-sandbox .sandbox-forward-empty { color: var(--sb-muted-fg); }

/* ---------- Rendered Markdown, lists, tables, code ---------- */
.zhin-sandbox .zhin-markdown { min-width: 0; color: inherit; font-size: 14px; line-height: 1.7; overflow-wrap: anywhere; }
.zhin-sandbox .zhin-markdown > * + * { margin-top: 8px; }
.zhin-sandbox .zhin-markdown--inverse { color: inherit; }
.zhin-sandbox .im-markdown-heading { font-weight: 700; line-height: 1.35; letter-spacing: -.01em; }
.zhin-sandbox .im-markdown-heading-1 { font-size: 20px; }
.zhin-sandbox .im-markdown-heading-2 { font-size: 18px; }
.zhin-sandbox .im-markdown-heading-3 { font-size: 16px; }
.zhin-sandbox .im-markdown-heading-4, .zhin-sandbox .im-markdown-heading-5, .zhin-sandbox .im-markdown-heading-6 { font-size: 14px; }
.zhin-sandbox .im-markdown-paragraph { margin: 0; }
.zhin-sandbox .im-markdown-quote { padding: 4px 12px; border-left: 3px solid var(--sb-border); color: var(--sb-muted-fg); }
.zhin-sandbox .im-markdown-list { padding-left: 22px; list-style: disc; }
.zhin-sandbox .im-markdown-list-ordered { list-style: decimal; }
.zhin-sandbox .im-markdown-list > li { padding-left: 2px; }
.zhin-sandbox .im-markdown-list > li + li { margin-top: 3px; }
.zhin-sandbox .im-markdown-list > li::marker { color: var(--sb-muted-fg); }
.zhin-sandbox .zhin-markdown-task { display: flex; align-items: baseline; gap: 8px; margin-left: -22px; list-style: none; }
.zhin-sandbox .zhin-markdown-task input { flex-shrink: 0; width: 14px; height: 14px; min-height: 0; margin: 0; padding: 0; accent-color: var(--sb-primary); transform: translateY(2px); }
.zhin-sandbox .zhin-markdown-rule { width: 100%; margin: 6px 0; border: 0; border-top: 1px solid var(--sb-border); }
.zhin-sandbox .im-inline-code { padding: 1px 6px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-sm); background: var(--sb-muted); font-family: var(--sb-mono); font-size: 13px; }
.zhin-sandbox .im-message-link { color: var(--sb-primary); }
.zhin-sandbox .zhin-markdown-table-wrap { width: 100%; max-width: 100%; overflow-x: auto; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-md); background: var(--sb-bg); }
.zhin-sandbox .zhin-markdown-table { width: 100%; min-width: 320px; border-collapse: collapse; font-size: 13px; line-height: 1.5; font-variant-numeric: tabular-nums; }
.zhin-sandbox .zhin-markdown-table th, .zhin-sandbox .zhin-markdown-table td { padding: 8px 12px; border-right: 1px solid var(--sb-border); border-bottom: 1px solid var(--sb-border); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.zhin-sandbox .zhin-markdown-table th { background: var(--sb-muted); font-weight: 650; white-space: nowrap; }
.zhin-sandbox .zhin-markdown-table tbody tr:nth-child(even) td { background: var(--sb-muted); }
.zhin-sandbox .zhin-markdown-table tr:last-child td { border-bottom: 0; }
.zhin-sandbox .zhin-markdown-table th:last-child, .zhin-sandbox .zhin-markdown-table td:last-child { border-right: 0; }
.zhin-sandbox .zhin-code-block { width: 100%; max-width: 100%; min-width: 0; overflow: hidden; margin: 4px 0; border: 1px solid hsl(218 18% 28%); border-radius: var(--sb-radius-md); background: hsl(220 19% 10%); color: hsl(210 30% 92%); font-family: var(--sb-mono); }
.zhin-sandbox .zhin-code-toolbar { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 2px 6px 2px 12px; border-bottom: 1px solid hsl(218 16% 24%); background: hsl(220 18% 13%); }
.zhin-sandbox .zhin-code-language { color: hsl(210 14% 72%); font-size: 12px; font-weight: 600; letter-spacing: .04em; }
.zhin-sandbox .zhin-code-streaming { color: hsl(151 48% 63%); font-size: 12px; }
.zhin-sandbox .zhin-code-streaming::before { display: inline-block; width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; background: currentColor; content: ""; animation: sandbox-breathe 1.2s ease-in-out infinite; }
.zhin-sandbox .zhin-code-actions { display: flex; gap: 2px; margin-left: auto; }
.zhin-sandbox .zhin-code-actions button, .zhin-sandbox .zhin-code-expand { min-height: 28px; border: 0; border-radius: var(--sb-radius-sm); background: transparent; color: hsl(210 14% 76%); font-size: 12px; }
.zhin-sandbox .zhin-code-actions button:hover:not(:disabled), .zhin-sandbox .zhin-code-expand:hover:not(:disabled) { background: hsl(215 18% 21%); color: hsl(0 0% 100%); }
.zhin-sandbox .zhin-code-pre { max-width: 100%; overflow: auto; padding: 8px 0 10px; font: inherit; font-size: 13px; line-height: 1.65; tab-size: 2; }
.zhin-sandbox .zhin-code-pre--wrap .zhin-code-line-content { white-space: pre-wrap; overflow-wrap: anywhere; }
.zhin-sandbox .zhin-code-line { display: table-row; }
.zhin-sandbox .zhin-code-line-number { display: table-cell; width: 42px; padding: 0 12px 0 8px; color: hsl(214 12% 55%); text-align: right; user-select: none; }
.zhin-sandbox .zhin-code-line-content { display: table-cell; min-width: 100%; padding-right: 16px; white-space: pre; }
.zhin-sandbox .zhin-code-token--comment { color: hsl(148 23% 60%); font-style: italic; }
.zhin-sandbox .zhin-code-token--string { color: hsl(44 68% 70%); }
.zhin-sandbox .zhin-code-token--number { color: hsl(192 62% 68%); }
.zhin-sandbox .zhin-code-token--keyword { color: hsl(328 63% 73%); font-weight: 500; }
.zhin-sandbox .zhin-code-token--literal { color: hsl(268 72% 76%); }
.zhin-sandbox .zhin-code-expand { width: 100%; padding: 6px; border-top: 1px solid hsl(218 16% 22%); border-radius: 0; background: hsl(220 18% 12%); }

/* ---------- Recovery panel ---------- */
.zhin-sandbox .agent-playground-recovery { display: grid; flex: none; gap: 12px; max-height: min(40dvh, 24rem); margin: 16px; overflow: auto; font-size: 14px; }
.zhin-sandbox .agent-playground-recovery > section, .zhin-sandbox .agent-playground-recovery > details { min-width: 0; padding: 14px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-md); background: var(--sb-bg); }
.zhin-sandbox .agent-playground-recovery h3 { margin-bottom: 12px; font-size: 14px; font-weight: 600; }
.zhin-sandbox .agent-playground-recovery summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 16px; cursor: pointer; }
.zhin-sandbox .agent-playground-recovery time { margin-left: auto; font-size: 12px; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-recovery details[open] summary { margin-bottom: 14px; }
.zhin-sandbox .agent-playground-recovery details > a { display: inline-flex; margin: 8px 12px 0 0; }
.zhin-sandbox .agent-playground-recovery > p[role=alert] { color: var(--sb-danger); overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-recovery > button, .zhin-sandbox .agent-playground-recovery > p > button { color: var(--sb-primary); }
.zhin-sandbox .agent-playground-main:has(> .agent-playground-recovery:not([hidden])) .agent-playground-empty { display: none; }

/* ---------- Inline run card ---------- */
.zhin-sandbox .agent-playground-inline-run { position: relative; overflow: hidden; margin-left: 40px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-lg); background: var(--sb-bg); }
.zhin-sandbox .agent-playground-inline-run-rail { position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--sb-primary); }
.zhin-sandbox .agent-playground-inline-run.is-running .agent-playground-inline-run-rail { background: var(--sb-info); }
.zhin-sandbox .agent-playground-inline-run.is-failed .agent-playground-inline-run-rail { background: var(--sb-danger); }
.zhin-sandbox .agent-playground-inline-run.is-cancelled .agent-playground-inline-run-rail { background: var(--sb-warn); }
.zhin-sandbox .agent-playground-inline-run-head { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: start; gap: 10px; padding: 14px 14px 12px 16px; }
.zhin-sandbox .agent-playground-inline-run-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid var(--sb-primary-line); border-radius: var(--sb-radius-md); background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-inline-run-copy { min-width: 0; }
.zhin-sandbox .agent-playground-inline-run-copy > span { display: block; font-size: 12px; font-weight: 600; letter-spacing: .04em; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-inline-run-copy h3 { font-size: 14px; font-weight: 700; }
.zhin-sandbox .agent-playground-inline-run-copy p { display: -webkit-box; margin-top: 3px; overflow: hidden; font-size: 12px; line-height: 1.5; color: var(--sb-muted-fg); overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.zhin-sandbox .agent-playground-inline-run-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.zhin-sandbox .agent-playground-inline-run-actions button { min-height: 30px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
.zhin-sandbox .agent-playground-inline-run-actions button.is-stop { background: var(--sb-danger-soft); border-color: var(--sb-danger-line); color: var(--sb-danger); }
.zhin-sandbox .agent-playground-inline-run-metrics { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); margin: 0; border-top: 1px solid var(--sb-border); border-bottom: 1px solid var(--sb-border); background: var(--sb-muted); font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-inline-run-metrics > div { display: flex; align-items: baseline; justify-content: center; gap: 5px; min-width: 0; padding: 7px 6px; border-right: 1px solid var(--sb-border); }
.zhin-sandbox .agent-playground-inline-run-metrics > div:last-child { border-right: 0; }
.zhin-sandbox .agent-playground-inline-run-metrics dt { font-size: 12px; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-inline-run-metrics dd { overflow: hidden; font-size: 13px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-inline-run-metrics .has-problem dd { color: var(--sb-danger); }
.zhin-sandbox .agent-playground-inline-run-steps { display: grid; padding: 6px 14px 6px 16px; list-style: none; }
.zhin-sandbox .agent-playground-inline-run-steps li { position: relative; display: grid; grid-template-columns: 12px minmax(0,1fr) auto; align-items: center; gap: 8px; min-height: 34px; }
.zhin-sandbox .agent-playground-inline-run-steps li:not(:last-child)::after { position: absolute; top: 20px; bottom: -14px; left: 5px; width: 1px; background: var(--sb-border); content: ""; }
.zhin-sandbox .agent-playground-inline-run-steps i { position: relative; z-index: 1; width: 10px; height: 10px; border: 2px solid var(--sb-bg); border-radius: 50%; background: var(--sb-primary); box-shadow: 0 0 0 1px var(--sb-primary-line); }
.zhin-sandbox .agent-playground-inline-run-steps li.is-running i { background: var(--sb-info); animation: sandbox-breathe 1.4s ease-in-out infinite; }
.zhin-sandbox .agent-playground-inline-run-steps li.is-failed i, .zhin-sandbox .agent-playground-inline-run-steps li.is-denied i { background: var(--sb-danger); }
.zhin-sandbox .agent-playground-inline-run-steps li.is-cancelled i { background: var(--sb-warn); }
.zhin-sandbox .agent-playground-inline-run-steps li > div { display: flex; flex-direction: column; min-width: 0; }
.zhin-sandbox .agent-playground-inline-run-steps strong { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-inline-run-steps small { overflow: hidden; font-size: 12px; color: var(--sb-muted-fg); text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-inline-run-steps li > span { font-size: 12px; color: var(--sb-muted-fg); font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-inline-run-steps li.is-failed > span, .zhin-sandbox .agent-playground-inline-run-steps li.is-denied > span { color: var(--sb-danger); }
.zhin-sandbox .agent-playground-inline-run-empty { padding: 12px 16px; font-size: 12px; text-align: center; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-inline-run footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 14px 8px 16px; }
.zhin-sandbox .agent-playground-inline-run footer button { min-height: 30px; padding: 2px 6px; border: 0; background: transparent; color: var(--sb-muted-fg); font-size: 12px; }
.zhin-sandbox .agent-playground-inline-run footer button:hover:not(:disabled) { color: var(--sb-primary); }
.zhin-sandbox .agent-playground-inline-run footer button:first-child svg { transition: transform .15s ease; }
.zhin-sandbox .agent-playground-inline-run footer button:first-child[aria-expanded="true"] svg { transform: rotate(180deg); }

/* ---------- Composer ---------- */
.zhin-sandbox .agent-playground-composer { position: relative; z-index: 2; display: grid; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--sb-border-soft); background: var(--sb-bg); }
.zhin-sandbox .sandbox-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.zhin-sandbox .sandbox-toolbar-spacer { flex: 1; min-width: 16px; }
.zhin-sandbox .sandbox-tool-button { width: 34px; padding: 4px; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-tool-button.is-active { background: var(--sb-primary); border-color: var(--sb-primary); color: var(--sb-primary-fg); }
.zhin-sandbox .sandbox-tool-button.is-active:hover:not(:disabled) { background: var(--sb-primary); opacity: .9; }
.zhin-sandbox .sandbox-composer-tabs { display: inline-flex; flex-shrink: 0; gap: 2px; padding: 3px; border-radius: var(--sb-radius-md); background: var(--sb-muted); }
.zhin-sandbox .sandbox-composer-tabs button { min-height: 28px; padding: 2px 10px; border-color: transparent; background: transparent; color: var(--sb-muted-fg); font-size: 12px; white-space: nowrap; }
.zhin-sandbox .sandbox-composer-tabs button.active { background: var(--sb-bg); color: var(--sb-fg); box-shadow: 0 1px 4px var(--sb-shadow); }
.zhin-sandbox .sandbox-panel { display: grid; gap: 8px; max-height: 256px; overflow-y: auto; padding: 12px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-md); background: var(--sb-muted); }
.zhin-sandbox .sandbox-panel-hint { font-size: 12px; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-panel .sandbox-submit { justify-self: start; }
.zhin-sandbox .sandbox-face-grid { display: grid; grid-template-columns: repeat(8, minmax(0,1fr)); gap: 4px; }
.zhin-sandbox .sandbox-face-button { width: 100%; min-width: 0; height: 40px; padding: 0; }
.zhin-sandbox .sandbox-face-img { width: 32px; height: 32px; }
.zhin-sandbox .sandbox-empty-hint { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px; font-size: 13px; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-empty-hint > svg { opacity: .5; }
.zhin-sandbox .sandbox-editor-row { display: flex; align-items: flex-start; gap: 8px; }
.zhin-sandbox .sandbox-editor-wrap { position: relative; flex: 1; min-width: 0; }
.zhin-sandbox .sandbox-send { min-height: 44px; padding: 8px 16px; font-weight: 600; }
.zhin-sandbox [contenteditable="true"] { min-height: 44px; padding: 10px 12px; background: var(--sb-muted); border: 1px solid var(--sb-input); border-radius: var(--sb-radius-md); line-height: 1.6; overflow-y: auto; outline: none; }
.zhin-sandbox [contenteditable="true"]:focus-visible { border-color: var(--sb-ring); outline: 2px solid var(--sb-ring); outline-offset: 1px; }
.zhin-sandbox [contenteditable="true"]:empty::before { content: attr(data-placeholder); color: var(--sb-muted-fg); pointer-events: none; }
.zhin-sandbox .editor-face { width: 24px; height: 24px; display: inline-block; vertical-align: middle; }
.zhin-sandbox .editor-image { max-width: 100%; max-height: 100px; display: inline-block; vertical-align: middle; border-radius: var(--sb-radius-sm); }
.zhin-sandbox .editor-video, .zhin-sandbox .editor-audio, .zhin-sandbox .editor-at { display: inline-flex; align-items: center; margin: 0 2px; padding: 0 8px; border-radius: var(--sb-radius-sm); background: var(--sb-accent); font-size: 13px; vertical-align: baseline; }
.zhin-sandbox .editor-at { color: var(--sb-primary); }
.zhin-sandbox .sandbox-markdown-preview { min-height: 44px; max-height: 240px; padding: 10px 12px; overflow: auto; background: var(--sb-muted); border: 1px solid var(--sb-border); border-radius: var(--sb-radius-md); }
.zhin-sandbox .sandbox-markdown-preview-empty { font-size: 13px; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-at-popover { position: absolute; z-index: 50; min-width: 240px; max-height: 288px; overflow-y: auto; padding: 4px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-md); background: hsl(var(--popover, 0 0% 100%)); box-shadow: 0 8px 24px var(--sb-shadow); }
.zhin-sandbox .sandbox-at-item { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: var(--sb-radius-sm); cursor: pointer; }
.zhin-sandbox .sandbox-at-item:hover { background: var(--sb-accent); }
.zhin-sandbox .sandbox-at-item > svg { flex-shrink: 0; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-at-name { font-size: 13px; font-weight: 600; }
.zhin-sandbox .sandbox-at-id { font-size: 12px; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-hints { font-size: 12px; line-height: 1.8; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-hints > summary { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; list-style: none; }
.zhin-sandbox .sandbox-hints > summary::-webkit-details-marker { display: none; }
.zhin-sandbox .sandbox-hints > summary:hover { color: var(--sb-fg); }
.zhin-sandbox .sandbox-hints > ul { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 4px 0 0; padding: 0; list-style: none; }
.zhin-sandbox .sandbox-hints li { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.zhin-sandbox .sandbox-more { position: relative; display: inline-flex; }
.zhin-sandbox .sandbox-more-trigger { color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-more-trigger.active { border-color: var(--sb-primary-line); background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .sandbox-more-backdrop { position: fixed; inset: 0; z-index: 40; }
.zhin-sandbox .sandbox-more-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 41; display: grid; min-width: 220px; padding: 4px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-sm); background: var(--sb-bg); box-shadow: 0 8px 24px rgb(0 0 0 / 0.12); }
.zhin-sandbox .sandbox-more-menu > button { display: flex; align-items: center; gap: 8px; justify-content: flex-start; width: 100%; padding: 8px 10px; border: 0; background: transparent; color: var(--sb-fg); font-size: 13px; text-align: left; }
.zhin-sandbox .sandbox-more-menu > button:hover { background: var(--sb-accent); }
.zhin-sandbox .sandbox-more-menu > button[aria-checked="true"] { color: var(--sb-primary); }
.zhin-sandbox .sandbox-more-menu > button.is-danger { color: var(--sb-danger); }
.zhin-sandbox .sandbox-more-menu > button > em { margin-left: auto; font-style: normal; }
.zhin-sandbox .sandbox-hint-key { padding: 1px 6px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-sm); background: var(--sb-muted); color: var(--sb-fg); font-family: var(--sb-mono); font-size: 12px; line-height: 1.4; }
.zhin-sandbox .sandbox-hint-text { margin-right: 6px; }

/* ---------- Inspector ---------- */
.zhin-sandbox .agent-playground-inspector { position: absolute; right: 0; top: 0; bottom: 0; z-index: 30; display: flex; flex-direction: column; width: min(360px, 90%); min-width: 0; overflow-y: auto; background: var(--sb-sidebar); border-left: 1px solid var(--sb-border); box-shadow: -12px 0 32px var(--sb-shadow); scrollbar-width: thin; }
.zhin-sandbox .agent-playground-inspector-head { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 10px; min-height: 68px; padding: 12px 16px; border-bottom: 1px solid var(--sb-border-soft); }
.zhin-sandbox .agent-playground-inspector-head > div:last-child { display: flex; gap: 6px; }
.zhin-sandbox .agent-playground-inspector-head > div:first-child > span { font-size: 12px; font-weight: 600; letter-spacing: .04em; color: var(--sb-primary); }
.zhin-sandbox .agent-playground-inspector-head h2 { font-size: 15px; font-weight: 700; }
.zhin-sandbox .agent-playground-inspector-head button { width: 34px; padding: 0; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-inspector-tabs { display: grid; flex-shrink: 0; grid-template-columns: 1fr 1.35fr; gap: 4px; margin: 10px 12px 0; padding: 3px; border: 1px solid var(--sb-border-soft); border-radius: var(--sb-radius-md); background: var(--sb-bg); }
.zhin-sandbox .agent-playground-inspector-tabs button { min-width: 0; min-height: 32px; border-color: transparent; background: transparent; color: var(--sb-muted-fg); font-size: 12px; font-weight: 600; }
.zhin-sandbox .agent-playground-inspector-tabs button.active { background: var(--sb-muted); border-color: var(--sb-border); color: var(--sb-fg); }
.zhin-sandbox .agent-playground-inspector-tabs button span { min-width: 18px; padding: 0 6px; border-radius: 999px; background: var(--sb-accent); color: var(--sb-muted-fg); font-size: 12px; font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-inspector-view { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.zhin-sandbox .agent-playground-inspector-section { padding: 14px; border-bottom: 1px solid var(--sb-border-soft); }
.zhin-sandbox .agent-playground-inspector-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; font-size: 13px; font-weight: 650; }
.zhin-sandbox .agent-playground-inspector-title small { font-size: 12px; font-weight: 500; letter-spacing: .03em; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-metrics { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); overflow: hidden; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-md); background: var(--sb-bg); }
.zhin-sandbox .agent-playground-metrics > div { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; min-width: 0; padding: 10px; }
.zhin-sandbox .agent-playground-metrics > div:nth-child(odd) { border-right: 1px solid var(--sb-border); }
.zhin-sandbox .agent-playground-metrics > div:nth-child(-n+2) { border-bottom: 1px solid var(--sb-border); }
.zhin-sandbox .agent-playground-metrics svg { grid-row: span 2; width: 15px; height: 15px; color: var(--sb-primary); }
.zhin-sandbox .agent-playground-metrics strong { overflow: hidden; font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; text-overflow: ellipsis; }
.zhin-sandbox .agent-playground-metrics span { font-size: 12px; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-metrics .has-problem svg, .zhin-sandbox .agent-playground-metrics .has-problem strong { color: var(--sb-danger); }
.zhin-sandbox .agent-playground-context-list { display: grid; }
.zhin-sandbox .agent-playground-context-list > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; padding: 6px 0; border-bottom: 1px dashed var(--sb-border); font-size: 12px; }
.zhin-sandbox .agent-playground-context-list > div:last-child { border-bottom: 0; }
.zhin-sandbox .agent-playground-context-list dt { flex-shrink: 0; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-context-list dd { min-width: 0; overflow: hidden; font-family: var(--sb-mono); text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-trace-section { flex: 1; }
.zhin-sandbox .agent-playground-trace-list { position: relative; display: grid; }
.zhin-sandbox .agent-playground-trace-list::before { position: absolute; top: 10px; bottom: 10px; left: 5px; width: 1px; background: var(--sb-border); content: ""; }
.zhin-sandbox .agent-playground-trace-item { position: relative; display: grid; grid-template-columns: 12px minmax(0,1fr) auto; align-items: start; gap: 8px; padding: 6px 0; font-size: 12px; }
.zhin-sandbox .agent-playground-trace-dot { position: relative; z-index: 1; width: 10px; height: 10px; margin-top: 5px; border: 2px solid var(--sb-sidebar); border-radius: 50%; background: var(--sb-muted-fg); box-shadow: 0 0 0 1px var(--sb-border); }
.zhin-sandbox .agent-playground-trace-item.is-success .agent-playground-trace-dot { background: var(--sb-ok); }
.zhin-sandbox .agent-playground-trace-item.is-running .agent-playground-trace-dot, .zhin-sandbox .agent-playground-trace-item.is-thinking .agent-playground-trace-dot { background: var(--sb-info); }
.zhin-sandbox .agent-playground-trace-item.is-tool .agent-playground-trace-dot, .zhin-sandbox .agent-playground-trace-item.is-usage .agent-playground-trace-dot { background: var(--sb-primary); }
.zhin-sandbox .agent-playground-trace-item.is-capability .agent-playground-trace-dot { background: var(--sb-warn); }
.zhin-sandbox .agent-playground-trace-item.is-problem .agent-playground-trace-dot { background: var(--sb-danger); }
.zhin-sandbox .agent-playground-trace-item > div { display: flex; flex-direction: column; min-width: 0; }
.zhin-sandbox .agent-playground-trace-item strong { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-trace-item small { overflow: hidden; font-size: 12px; color: var(--sb-muted-fg); text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-trace-item time { margin-top: 2px; font-size: 12px; color: var(--sb-muted-fg); font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-trace-loading, .zhin-sandbox .agent-playground-trace-empty, .zhin-sandbox .agent-playground-trace-notice, .zhin-sandbox .agent-playground-artifact-empty { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 80px; padding: 12px; border: 1px dashed var(--sb-border); border-radius: var(--sb-radius-md); font-size: 12px; line-height: 1.5; text-align: center; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-artifact-empty { flex-direction: column; min-height: 104px; }
.zhin-sandbox .agent-playground-trace-notice { min-height: 0; margin-bottom: 10px; border-color: var(--sb-warn-line); color: var(--sb-warn); }
.zhin-sandbox .agent-playground-trace-loading i { width: 6px; height: 6px; border-radius: 50%; background: var(--sb-primary); animation: sandbox-pulse .9s ease-in-out infinite alternate; }
.zhin-sandbox .agent-playground-trace-loading i:nth-child(2) { animation-delay: .15s; }
.zhin-sandbox .agent-playground-trace-loading i:nth-child(3) { animation-delay: .3s; }
.zhin-sandbox .agent-playground-task-section, .zhin-sandbox .agent-playground-artifact-section { flex: 0 0 auto; }
.zhin-sandbox .agent-playground-artifact-section { flex: 1 0 auto; }
.zhin-sandbox .agent-playground-task-list, .zhin-sandbox .agent-playground-artifact-list { display: grid; gap: 8px; }
.zhin-sandbox .agent-playground-task-list article { display: grid; grid-template-columns: 10px minmax(0,1fr); gap: 2px 8px; padding: 10px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-md); background: var(--sb-bg); }
.zhin-sandbox .agent-playground-task-list article > i { width: 8px; height: 8px; margin-top: 7px; border-radius: 50%; background: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-task-list article.is-running > i { background: var(--sb-info); }
.zhin-sandbox .agent-playground-task-list article.is-completed > i { background: var(--sb-ok); }
.zhin-sandbox .agent-playground-task-list article.is-failed > i { background: var(--sb-danger); }
.zhin-sandbox .agent-playground-task-list article.is-cancelled > i { background: var(--sb-warn); }
.zhin-sandbox .agent-playground-task-list article > div { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.zhin-sandbox .agent-playground-task-list strong { font-size: 13px; font-weight: 650; }
.zhin-sandbox .agent-playground-task-list code { overflow: hidden; font-family: var(--sb-mono); font-size: 12px; color: var(--sb-muted-fg); text-overflow: ellipsis; }
.zhin-sandbox .agent-playground-task-list dl { display: grid; grid-column: 2; grid-template-columns: repeat(3, minmax(0,1fr)); margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--sb-border); }
.zhin-sandbox .agent-playground-task-list dl > div { display: flex; flex-direction: column; }
.zhin-sandbox .agent-playground-task-list dt { font-size: 12px; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-task-list dd { font-size: 12px; font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-artifact-list article { overflow: hidden; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-md); background: var(--sb-bg); }
.zhin-sandbox .agent-playground-artifact-list article.is-expanded { border-color: var(--sb-primary-line); }
.zhin-sandbox .agent-playground-artifact-list article > button { display: grid; grid-template-columns: auto minmax(0,1fr) auto auto; gap: 8px; align-items: center; width: 100%; padding: 8px 10px; border: 0; border-radius: 0; background: transparent; text-align: left; }
.zhin-sandbox .agent-playground-artifact-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--sb-primary-line); border-radius: var(--sb-radius-sm); background: var(--sb-primary-soft); color: var(--sb-primary); }
.zhin-sandbox .agent-playground-artifact-list article > button > span:nth-child(2) { display: flex; flex-direction: column; min-width: 0; }
.zhin-sandbox .agent-playground-artifact-list strong, .zhin-sandbox .agent-playground-artifact-list small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-artifact-list strong { font-size: 13px; font-weight: 600; }
.zhin-sandbox .agent-playground-artifact-list small, .zhin-sandbox .agent-playground-artifact-list em { font-size: 12px; font-style: normal; color: var(--sb-muted-fg); }
.zhin-sandbox .agent-playground-artifact-list article.is-completed em { color: var(--sb-ok); }
.zhin-sandbox .agent-playground-artifact-list article.is-failed em, .zhin-sandbox .agent-playground-artifact-list article.is-denied em { color: var(--sb-danger); }
.zhin-sandbox .agent-playground-artifact-list article > button > svg { color: var(--sb-muted-fg); transition: transform .16s ease; }
.zhin-sandbox .agent-playground-artifact-list article.is-expanded > button > svg { transform: rotate(180deg); }
.zhin-sandbox .agent-playground-artifact-detail { display: grid; gap: 8px; padding: 0 10px 10px 46px; font-size: 12px; }
.zhin-sandbox .agent-playground-artifact-detail > code { font-family: var(--sb-mono); font-size: 12px; color: var(--sb-muted-fg); overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-artifact-detail pre { max-height: 240px; overflow: auto; padding: 10px; border: 1px solid var(--sb-border); border-radius: var(--sb-radius-sm); background: var(--sb-muted); font-family: var(--sb-mono); font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.zhin-sandbox .agent-playground-artifact-detail footer { display: flex; justify-content: space-between; gap: 8px; color: var(--sb-muted-fg); }
.zhin-sandbox .sandbox-file-link { display: inline-flex; align-items: center; gap: 4px; color: var(--sb-primary); }
.zhin-sandbox .agent-playground-studio-link { display: flex; flex-shrink: 0; flex-direction: column; gap: 4px; margin: 12px; padding: 10px 12px; border: 1px solid var(--sb-primary-line); border-radius: var(--sb-radius-md); background: var(--sb-primary-soft); color: var(--sb-primary); font-size: 13px; text-decoration: none; }
.zhin-sandbox .agent-playground-studio-link > span { display: flex; align-items: center; gap: 6px; font-weight: 650; }
.zhin-sandbox .agent-playground-studio-link code { overflow: hidden; font-family: var(--sb-mono); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; opacity: .8; }

/* ---------- Animations ---------- */
@keyframes sandbox-spin { to { transform: rotate(360deg); } }
@keyframes sandbox-breathe { 0%, 100% { opacity: .5; transform: scale(.92); } 50% { opacity: 1; transform: scale(1); } }
@keyframes sandbox-pulse { from { opacity: .25; transform: translateY(1px); } to { opacity: 1; transform: translateY(-1px); } }

/* ---------- Responsive ---------- */
@media (min-width: 1280px) {
  .zhin-sandbox.agent-playground-shell.has-inspector { grid-template-columns: 232px minmax(0,1fr) 330px; }
  .zhin-sandbox .agent-playground-inspector { position: static; width: auto; box-shadow: none; }
}
@media (max-width: 1279px) {
  .zhin-sandbox .agent-playground-inspector-overlay { display: block; position: absolute; inset: 0; z-index: 25; background: var(--sb-overlay); }
}
@media (max-width: 1023px) {
  .zhin-sandbox .agent-playground-inline-run-metrics { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .zhin-sandbox .agent-playground-inline-run-metrics > div:nth-child(3) { border-right: 0; }
  .zhin-sandbox .agent-playground-inline-run-metrics > div:nth-child(n+4) { border-top: 1px solid var(--sb-border); }
}
@media (max-width: 767px) {
  .zhin-sandbox.agent-playground-shell { grid-template-columns: minmax(0,1fr); grid-template-rows: auto minmax(0,1fr); height: calc(100dvh - 92px); min-height: 480px; border-radius: var(--sb-radius-md); }
  .zhin-sandbox button, .zhin-sandbox .agent-playground-run-actions > a { min-height: 44px; min-width: 44px; }
  .zhin-sandbox :where(input:not([type="checkbox"]), select) { min-height: 44px; font-size: 16px; }
  .zhin-sandbox .agent-playground-network-toggle { min-height: 44px; }
  .zhin-sandbox .agent-playground-network-toggle i { width: 44px; height: 26px; }
  .zhin-sandbox .agent-playground-network-toggle i::after { width: 20px; height: 20px; }
  .zhin-sandbox .agent-playground-network-toggle input:checked + i::after { transform: translateX(18px); }
  .zhin-sandbox .agent-playground-mobilebar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--sb-border); background: var(--sb-bg); }
  .zhin-sandbox .agent-playground-mobilebar strong { font-size: 14px; }
  .zhin-sandbox .agent-playground-mobilebar button { min-height: 44px; padding: 6px 10px; border-color: transparent; background: transparent; color: var(--sb-muted-fg); font-size: 13px; }
  .zhin-sandbox .agent-playground-sessions { display: none; position: absolute; inset: 0 auto 0 0; z-index: 40; width: min(300px, 88%); box-shadow: 12px 0 32px var(--sb-shadow); }
  .zhin-sandbox .agent-playground-sessions.show { display: flex; }
  .zhin-sandbox .channel-overlay { display: block; position: absolute; inset: 0; z-index: 35; background: var(--sb-overlay); }
  .zhin-sandbox .agent-playground-runbar { flex-direction: column; align-items: flex-start; gap: 10px; min-height: 0; padding: 12px; }
  /* In a column the 14rem flex-basis would become the identity row height. */
  .zhin-sandbox .agent-playground-run-identity { flex: 0 0 auto; width: 100%; }
  .zhin-sandbox .agent-playground-run-actions { flex-wrap: wrap; justify-content: flex-start; margin-left: 0; max-width: 100%; }
  .zhin-sandbox .sandbox-more-menu { right: auto; left: 0; }
  .zhin-sandbox .agent-playground-run-actions > a, .zhin-sandbox .agent-playground-run-actions > button { flex-shrink: 0; white-space: nowrap; width: auto; font-size: 13px; }
  .zhin-sandbox .agent-playground-run-title span { display: none; }
  .zhin-sandbox .agent-playground-message-scroll { padding: 16px 10px; }
  .zhin-sandbox .agent-playground-message-main { max-width: calc(100% - 40px); }
  .zhin-sandbox .agent-playground-message.is-user .agent-playground-message-main { max-width: 86%; }
  .zhin-sandbox .agent-playground-message-content { padding: 8px 12px; }
  .zhin-sandbox .agent-playground-composer { padding: 10px 12px; }
  .zhin-sandbox .sandbox-toolbar-spacer { display: none; }
  .zhin-sandbox .sandbox-composer-tabs button { padding: 4px 12px; }
  .zhin-sandbox .sandbox-face-grid { grid-template-columns: repeat(6, minmax(0,1fr)); }
  .zhin-sandbox .sandbox-face-button { height: 44px; }
  .zhin-sandbox .sandbox-hints { display: none; }
  .zhin-sandbox .agent-playground-confirm, .zhin-sandbox .sandbox-notice { padding: 10px 12px; flex-wrap: wrap; }
  .zhin-sandbox .agent-playground-confirm > div { flex-basis: 100%; }
  .zhin-sandbox .agent-playground-run-settings { max-height: 256px; overflow-y: auto; padding: 12px; }
  .zhin-sandbox .agent-playground-empty { padding: 20px 0; }
  .zhin-sandbox .agent-playground-prompts { grid-template-columns: 1fr; }
  .zhin-sandbox .agent-playground-inline-run { margin-left: 0; }
  .zhin-sandbox .agent-playground-inline-run-head { grid-template-columns: auto minmax(0,1fr); }
  .zhin-sandbox .agent-playground-inline-run-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .zhin-sandbox .agent-playground-scope-picker button, .zhin-sandbox .agent-playground-section-label button, .zhin-sandbox .agent-playground-inspector-tabs button, .zhin-sandbox .sandbox-composer-tabs button, .zhin-sandbox .agent-playground-confirm button, .zhin-sandbox .agent-playground-inline-run-actions button, .zhin-sandbox .agent-playground-inline-run footer button, .zhin-sandbox .zhin-code-actions button, .zhin-sandbox .zhin-code-expand, .zhin-sandbox .sandbox-notice button, .zhin-sandbox .agent-playground-history-navigation button, .zhin-sandbox .agent-playground-inspector-head button, .zhin-sandbox .sandbox-tool-button { min-height: 44px; min-width: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .zhin-sandbox *, .zhin-sandbox *::before, .zhin-sandbox *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;
