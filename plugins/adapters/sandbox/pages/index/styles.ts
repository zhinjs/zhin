/** The adapter owns its workbench presentation; no styles from a particular Console shell are required. */
export const sandboxStyles = `
.zhin-sandbox.agent-playground-shell { position: relative; display: grid; grid-template-columns: 232px minmax(0,1fr); height: calc(100dvh - 72px); min-height: 520px; overflow: hidden; border: 1px solid var(--ac-line); border-radius: 14px; background: var(--ac-panel); }
.zhin-sandbox [hidden], .zhin-sandbox .hidden { display: none !important; }
.zhin-sandbox button { display: inline-flex; justify-content: center; align-items: center; gap: 7px; border: 1px solid var(--ac-line); border-radius: 8px; min-height: 34px; padding: 6px 10px; color: var(--ac-ink); background: var(--ac-panel); cursor: pointer; font-size: 12px; line-height: 1.4; }
.zhin-sandbox button:hover:not(:disabled) { background: var(--ac-soft); }
.zhin-sandbox button:disabled { opacity: .45; cursor: not-allowed; }
.zhin-sandbox button.primary { background: var(--ac-primary); color: var(--ac-panel); border-color: var(--ac-primary); }
.zhin-sandbox button.danger, .zhin-sandbox .agent-playground-stop { color: var(--ac-bad); background: var(--ac-bad-bg); border-color: transparent; }
.zhin-sandbox .agent-playground-mobilebar { display: none; }
.zhin-sandbox .agent-playground-sessions { min-width: 0; display: flex; flex-direction: column; background: var(--ac-canvas); border-right: 1px solid var(--ac-line); overflow: hidden; }
.zhin-sandbox .agent-playground-brand { padding: 24px 18px; }
.zhin-sandbox .agent-playground-brand > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.zhin-sandbox .agent-playground-brand > div > div { display: flex; align-items: center; gap: 10px; }
.zhin-sandbox .agent-playground-brand h2 { font-size: 18px; font-weight: 650; letter-spacing: -.02em; }
.zhin-sandbox .agent-playground-brand small { font-size: 11px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: var(--ac-ink); color: var(--ac-panel); }
.zhin-sandbox .agent-playground-connection { display: grid; place-items: center; color: var(--ac-warn); }
.zhin-sandbox .agent-playground-connection.is-online, .zhin-sandbox .is-online { color: var(--ac-ok); }
.zhin-sandbox .agent-playground-section-label { display: flex; align-items: center; gap: 8px; padding: 0 18px 10px; font-size: 12px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-section-label button { margin-left: auto; min-height: 28px; padding: 4px; background: transparent; border-color: transparent; }
.zhin-sandbox .agent-playground-session-list { flex: 1; min-height: 0; overflow: auto; padding: 0 10px; }
.zhin-sandbox .agent-playground-session { display: flex; justify-content: flex-start; width: 100%; gap: 10px; padding: 12px 10px; border: 1px solid transparent; margin-bottom: 4px; background: transparent; text-align: left; }
.zhin-sandbox .agent-playground-session.active { background: var(--ac-panel); border-color: var(--ac-line); box-shadow: 0 2px 3px #19283e05; }
.zhin-sandbox .agent-playground-session-icon { color: var(--ac-muted); }
.zhin-sandbox .agent-playground-session.active .agent-playground-session-icon { color: var(--ac-primary); }
.zhin-sandbox .agent-playground-session > div { flex: 1; min-width: 0; }
.zhin-sandbox .agent-playground-session > div > div:first-child { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-session > div > div:last-child { font-size: 11px; color: var(--ac-muted); margin-top: 4px; }
.zhin-sandbox .agent-playground-new-session { padding: 16px 14px; }
.zhin-sandbox .agent-playground-add { width: 100%; background: var(--ac-panel); }
.zhin-sandbox .agent-playground-new-form { display: grid; gap: 10px; }
.zhin-sandbox .agent-playground-scope-picker, .zhin-sandbox .agent-playground-new-actions { display: flex; gap: 5px; }
.zhin-sandbox .agent-playground-scope-picker button { flex: 1; font-size: 11px; padding: 6px; }
.zhin-sandbox .agent-playground-scope-picker button.active { border-color: var(--ac-primary); color: var(--ac-primary); background: var(--ac-tint); }
.zhin-sandbox .agent-playground-new-actions { justify-content: flex-end; }
.zhin-sandbox .agent-playground-endpoint { padding: 14px 18px; border-top: 1px solid var(--ac-line); display: grid; gap: 3px; }
.zhin-sandbox .agent-playground-endpoint span { font-size: 11px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-endpoint strong { font-size: 12px; font-weight: 550; overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-main { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; }
.zhin-sandbox .agent-playground-runbar { padding: 18px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--ac-line); }
.zhin-sandbox .agent-playground-run-identity { display: flex; gap: 10px; align-items: center; min-width: 0; }
.zhin-sandbox .agent-playground-run-identity > div { min-width: 0; }
.zhin-sandbox .agent-playground-run-icon { color: var(--ac-primary); }
.zhin-sandbox .agent-playground-run-title h1 { font-size: 16px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zhin-sandbox .agent-playground-run-title span { font-size: 11px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-run-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.zhin-sandbox .agent-playground-run-actions > a { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 6px; text-decoration: none; }
.zhin-sandbox .agent-playground-run-state { display: inline-flex; align-items: center; gap: 5px; color: var(--ac-muted); font-size: 11px; }
.zhin-sandbox .agent-playground-run-state.is-running { color: var(--ac-primary); }
.zhin-sandbox .agent-playground-run-state.has-problem { color: var(--ac-bad); }
.zhin-sandbox .agent-playground-confirm { display: flex; align-items: center; gap: 10px; background: var(--ac-warn-bg); color: var(--ac-warn); padding: 12px 20px; border-bottom: 1px solid var(--ac-line); font-size: 12px; }
.zhin-sandbox .agent-playground-confirm > div { flex: 1; display: grid; gap: 3px; min-width: 0; overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-run-settings { display: flex; flex-wrap: wrap; gap: 14px; padding: 16px 24px; background: var(--ac-canvas); border-bottom: 1px solid var(--ac-line); }
.zhin-sandbox .agent-playground-run-settings label { display: grid; gap: 5px; flex: 1; min-width: 140px; }
.zhin-sandbox .agent-playground-run-settings label > span { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-run-settings input, .zhin-sandbox .agent-playground-run-settings select { font-size: 12px; padding: 7px 9px; }
.zhin-sandbox .agent-playground-run-settings .agent-playground-directory-field { flex-basis: 100%; }
.zhin-sandbox .agent-playground-run-settings .agent-playground-network-toggle { display: flex; align-items: center; gap: 10px; flex: none; }
.zhin-sandbox .agent-playground-network-toggle i { display: none; }
.zhin-sandbox .agent-playground-run-settings p { display: flex; gap: 7px; align-items: flex-start; font-size: 12px; color: var(--ac-warn); flex-basis: 100%; }
.zhin-sandbox .agent-playground-conversation { flex: 1; display: flex; min-height: 0; overflow: hidden; }
.zhin-sandbox .agent-playground-message-scroll { flex: 1; min-width: 0; overflow-y: auto; padding: 28px 24px; scrollbar-gutter: stable; }
.zhin-sandbox .agent-playground-empty { max-width: 560px; margin: clamp(24px, 8vh, 100px) auto 32px; text-align: center; }
.zhin-sandbox .agent-playground-empty-mark { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 20px; border-radius: 18px; background: var(--ac-tint); color: var(--ac-primary); }
.zhin-sandbox .agent-playground-empty h2 { font-size: clamp(18px, 2vw, 24px); font-weight: 650; letter-spacing: -.025em; margin-bottom: 10px; }
.zhin-sandbox .agent-playground-empty p { color: var(--ac-muted); font-size: 13px; line-height: 1.8; max-width: 48ch; margin: 0 auto; }
.zhin-sandbox .agent-playground-prompts { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 24px; }
.zhin-sandbox .agent-playground-prompts button { padding: 9px 12px; }
.zhin-sandbox .agent-playground-message-list { display: grid; gap: 24px; max-width: 780px; margin: 0 auto; }
.zhin-sandbox .agent-playground-message { display: flex; align-items: flex-start; gap: 12px; }
.zhin-sandbox .agent-playground-message-avatar { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--ac-tint); color: var(--ac-primary); flex-shrink: 0; }
.zhin-sandbox .agent-playground-message.is-user .agent-playground-message-avatar { background: var(--ac-soft); color: var(--ac-muted); }
.zhin-sandbox .agent-playground-message-main { flex: 1; min-width: 0; }
.zhin-sandbox .agent-playground-message-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.zhin-sandbox .agent-playground-message-meta strong { font-size: 12px; font-weight: 650; }
.zhin-sandbox .agent-playground-message-meta time { font-size: 10px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-message-meta span { color: var(--ac-warn); font-size: 10px; }
.zhin-sandbox .agent-playground-message-content { line-height: 1.8; overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-message-content img { max-width: 100%; border-radius: 10px; }
.zhin-sandbox .agent-playground-message.is-user .agent-playground-message-content { background: var(--ac-canvas); border-radius: 10px; padding: 12px 16px; }
.zhin-sandbox .agent-playground-message.is-approval { padding: 16px; background: var(--ac-warn-bg); border: 1px solid var(--ac-line); border-radius: 10px; }
.zhin-sandbox .agent-playground-composer { padding: 16px 24px; border-top: 1px solid var(--ac-line); display: grid; gap: 12px; background: var(--ac-panel); }
.zhin-sandbox .agent-playground-composer > div:first-child { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.zhin-sandbox .agent-playground-composer > div:first-child > div.flex-1 { flex: 1; }
.zhin-sandbox .agent-playground-composer > div:nth-last-child(2) { display: flex; align-items: flex-end; gap: 10px; }
.zhin-sandbox .agent-playground-composer > div:nth-last-child(2) > div { flex: 1; min-width: 0; }
.zhin-sandbox .agent-playground-composer > div:nth-last-child(2) > button { min-height: 42px; padding: 10px 16px; background: var(--ac-primary); border-color: var(--ac-primary); color: var(--ac-panel); }
.zhin-sandbox .agent-playground-composer > div:last-child { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; font-size: 10px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-composer > div:last-child span { padding: 1px 4px; border: 1px solid var(--ac-line); border-radius: 4px; }
.zhin-sandbox [contenteditable="true"] { padding: 12px 14px; background: var(--ac-canvas); border: 1px solid var(--ac-line); border-radius: 10px; line-height: 1.6; overflow-y: auto; outline: none; }
.zhin-sandbox [contenteditable="true"]:focus-visible { border-color: var(--ac-primary); outline: 2px solid var(--ac-primary); outline-offset: 1px; }
.zhin-sandbox [contenteditable="true"]:empty::before { content: attr(data-placeholder); color: var(--ac-muted); pointer-events: none; }
.zhin-sandbox .editor-face { width: 24px; height: 24px; display: inline-block; vertical-align: middle; }
.zhin-sandbox .editor-image { max-height: 100px; max-width: 100%; display: inline-block; }
.zhin-sandbox .sandbox-composer-tabs { display: flex; gap: 3px; padding: 3px; background: var(--ac-soft); border-radius: 8px; }
.zhin-sandbox .sandbox-composer-tabs button { border-color: transparent; min-height: 26px; background: transparent; }
.zhin-sandbox .sandbox-composer-tabs button.active { color: var(--ac-primary); background: var(--ac-panel); }
.zhin-sandbox .sandbox-markdown-preview { max-height: 200px; min-height: 44px; padding: 12px; overflow: auto; background: var(--ac-canvas); border: 1px solid var(--ac-line); border-radius: 10px; }
.zhin-sandbox .sandbox-markdown-preview-empty { color: var(--ac-muted); }
.zhin-sandbox .agent-playground-inspector { position: absolute; right: 0; top: 0; bottom: 0; width: min(360px, 90%); z-index: 30; display: flex; flex-direction: column; background: var(--ac-canvas); border-left: 1px solid var(--ac-line); overflow: auto; }
.zhin-sandbox .agent-playground-inspector-head { display: flex; justify-content: space-between; align-items: center; padding: 20px; border-bottom: 1px solid var(--ac-line); }
.zhin-sandbox .agent-playground-inspector-head > div:last-child { display: flex; gap: 6px; }
.zhin-sandbox .agent-playground-inspector-head span { font-size: 11px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-inspector-head h2 { font-size: 17px; font-weight: 650; }
.zhin-sandbox .agent-playground-inspector-tabs { display: flex; gap: 6px; padding: 14px 16px; }
.zhin-sandbox .agent-playground-inspector-tabs button { flex: 1; background: transparent; border-color: transparent; }
.zhin-sandbox .agent-playground-inspector-tabs button.active { background: var(--ac-panel); border-color: var(--ac-line); color: var(--ac-primary); }
.zhin-sandbox .agent-playground-inspector-section { padding: 18px 20px; border-bottom: 1px solid var(--ac-line); }
.zhin-sandbox .agent-playground-inspector-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; font-size: 12px; font-weight: 650; }
.zhin-sandbox .agent-playground-inspector-title small { color: var(--ac-muted); font-weight: 400; font-size: 10px; }
.zhin-sandbox .agent-playground-metrics { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
.zhin-sandbox .agent-playground-metrics > div { display: grid; grid-template-columns: 20px 1fr; align-items: center; gap: 4px 8px; padding: 12px; border: 1px solid var(--ac-line); background: var(--ac-panel); border-radius: 8px; }
.zhin-sandbox .agent-playground-metrics svg { width: 15px; height: 15px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-metrics strong { font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-metrics span { grid-column: 2; font-size: 10px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-metrics .has-problem svg { color: var(--ac-bad); }
.zhin-sandbox .agent-playground-context-list { display: grid; gap: 8px; font-size: 11px; }
.zhin-sandbox .agent-playground-context-list > div { display: grid; grid-template-columns: 64px minmax(0,1fr); gap: 8px; }
.zhin-sandbox .agent-playground-context-list dt { color: var(--ac-muted); }
.zhin-sandbox .agent-playground-context-list dd { overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-trace-list { display: grid; gap: 14px; }
.zhin-sandbox .agent-playground-trace-item { display: flex; align-items: flex-start; gap: 8px; font-size: 11px; }
.zhin-sandbox .agent-playground-trace-item > div { flex: 1; min-width: 0; display: grid; gap: 3px; }
.zhin-sandbox .agent-playground-trace-item strong { font-weight: 600; }
.zhin-sandbox .agent-playground-trace-item small, .zhin-sandbox .agent-playground-trace-item time { color: var(--ac-muted); font-size: 10px; overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-trace-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ac-muted); flex-shrink: 0; margin-top: 6px; }
.zhin-sandbox .agent-playground-trace-item.is-error .agent-playground-trace-dot { background: var(--ac-bad); }
.zhin-sandbox .agent-playground-artifact-empty, .zhin-sandbox .agent-playground-trace-empty, .zhin-sandbox .agent-playground-trace-notice { display: flex; gap: 10px; align-items: flex-start; font-size: 12px; color: var(--ac-muted); padding: 12px 0; }
.zhin-sandbox .agent-playground-trace-notice { color: var(--ac-bad); }
.zhin-sandbox .agent-playground-task-list, .zhin-sandbox .agent-playground-artifact-list { display: grid; gap: 8px; }
.zhin-sandbox .agent-playground-task-list article { padding: 12px; border: 1px solid var(--ac-line); background: var(--ac-panel); border-radius: 8px; }
.zhin-sandbox .agent-playground-task-list article > div { display: flex; justify-content: space-between; font-size: 11px; }
.zhin-sandbox .agent-playground-task-list code { color: var(--ac-muted); font-size: 10px; }
.zhin-sandbox .agent-playground-task-list dl { display: flex; gap: 14px; margin-top: 8px; font-size: 10px; }
.zhin-sandbox .agent-playground-task-list dt { color: var(--ac-muted); }
.zhin-sandbox .agent-playground-artifact-list article { border: 1px solid var(--ac-line); background: var(--ac-panel); border-radius: 8px; overflow: hidden; }
.zhin-sandbox .agent-playground-artifact-list article > button { width: 100%; border: 0; border-radius: 0; padding: 12px; text-align: left; }
.zhin-sandbox .agent-playground-artifact-list article > button > span:nth-child(2) { flex: 1; min-width: 0; display: grid; gap: 4px; }
.zhin-sandbox .agent-playground-artifact-list small { color: var(--ac-muted); font-size: 10px; overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-artifact-list em { font-style: normal; color: var(--ac-muted); font-size: 10px; }
.zhin-sandbox .agent-playground-artifact-detail { padding: 12px; font-size: 11px; display: grid; gap: 8px; }
.zhin-sandbox .agent-playground-artifact-detail pre { max-height: 320px; overflow: auto; padding: 10px; background: var(--ac-canvas); border-radius: 6px; }
.zhin-sandbox .agent-playground-artifact-detail footer { display: flex; justify-content: space-between; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-studio-link { display: grid; gap: 6px; padding: 18px 20px; font-size: 12px; margin-top: auto; border-top: 1px solid var(--ac-line); text-decoration: none; }
.zhin-sandbox .agent-playground-studio-link span { display: flex; gap: 7px; align-items: center; }
.zhin-sandbox .agent-playground-studio-link code { color: var(--ac-muted); font-size: 10px; overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-inspector-overlay, .zhin-sandbox .channel-overlay { display: none; }
.zhin-sandbox .agent-playground-inline-run { border: 1px solid var(--ac-line); border-radius: 10px; padding: 16px; background: var(--ac-canvas); }
.zhin-sandbox .agent-playground-inline-run-head { display: flex; align-items: flex-start; gap: 10px; }
.zhin-sandbox .agent-playground-inline-run-icon { color: var(--ac-muted); padding-top: 4px; }
.zhin-sandbox .agent-playground-inline-run-copy { flex: 1; min-width: 0; }
.zhin-sandbox .agent-playground-inline-run-copy > span { font-size: 10px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-inline-run-copy h3 { font-size: 14px; font-weight: 600; }
.zhin-sandbox .agent-playground-inline-run-copy p { font-size: 12px; color: var(--ac-muted); overflow-wrap: anywhere; margin-top: 4px; }
.zhin-sandbox .agent-playground-inline-run-actions { display: flex; gap: 6px; }
.zhin-sandbox .agent-playground-inline-run-metrics { display: flex; flex-wrap: wrap; gap: 20px; padding: 14px 0; border-bottom: 1px solid var(--ac-line); font-variant-numeric: tabular-nums; }
.zhin-sandbox .agent-playground-inline-run-metrics dt { font-size: 10px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-inline-run-metrics dd { font-size: 13px; font-weight: 600; }
.zhin-sandbox .agent-playground-inline-run-steps { padding: 0; list-style: none; margin: 16px 0; display: grid; gap: 12px; }
.zhin-sandbox .agent-playground-inline-run-steps li { display: flex; align-items: flex-start; gap: 8px; }
.zhin-sandbox .agent-playground-inline-run-steps li > div { flex: 1; min-width: 0; display: grid; gap: 4px; }
.zhin-sandbox .agent-playground-inline-run-steps strong { font-size: 12px; font-weight: 600; }
.zhin-sandbox .agent-playground-inline-run-steps small, .zhin-sandbox .agent-playground-inline-run-steps li > span { font-size: 10px; color: var(--ac-muted); overflow-wrap: anywhere; }
.zhin-sandbox .agent-playground-inline-run-steps i { width: 6px; height: 6px; margin-top: 6px; border-radius: 50%; background: var(--ac-muted); flex-shrink: 0; }
.zhin-sandbox .agent-playground-inline-run-steps .is-failed i { background: var(--ac-bad); }
.zhin-sandbox .agent-playground-inline-run-empty { font-size: 12px; padding-top: 12px; color: var(--ac-muted); }
.zhin-sandbox .agent-playground-inline-run footer { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.zhin-sandbox .agent-playground-inline-run footer { margin-top: 12px; }
.zhin-sandbox .agent-playground-conversation-details { padding: 20px; overflow: auto; flex: 1; }
.zhin-sandbox .agent-playground-history-navigation, .zhin-sandbox .agent-playground-history-notice { text-align: center; padding: 10px; color: var(--ac-muted); font-size: 12px; }
@media (min-width: 1280px) {
  .zhin-sandbox.agent-playground-shell.has-inspector { grid-template-columns: 232px minmax(0,1fr) 330px; }
  .zhin-sandbox .agent-playground-inspector { position: static; width: auto; }
}
@media (max-width: 1279px) {
  .zhin-sandbox .agent-playground-inspector-overlay { display: block; position: absolute; inset: 0; background: #18181b40; z-index: 25; }
}
@media (max-width: 767px) {
  .zhin-sandbox.agent-playground-shell { grid-template-columns: minmax(0,1fr); grid-template-rows: auto minmax(0,1fr); height: calc(100dvh - 92px); min-height: 480px; border-radius: 10px; }
  .zhin-sandbox .agent-playground-mobilebar { display: flex; align-items: center; justify-content: space-between; padding: 10px; border-bottom: 1px solid var(--ac-line); }
  .zhin-sandbox .agent-playground-mobilebar strong { font-size: 13px; }
  .zhin-sandbox .agent-playground-mobilebar button { font-size: 11px; padding: 6px; }
  .zhin-sandbox .agent-playground-sessions { display: none; position: absolute; inset: 0 auto 0 0; width: min(280px,85%); z-index: 40; }
  .zhin-sandbox .agent-playground-sessions.show { display: flex; }
  .zhin-sandbox .channel-overlay { display: block; position: absolute; inset: 0; z-index: 35; background: #18181b40; }
  .zhin-sandbox .agent-playground-runbar { padding: 12px; align-items: flex-start; flex-direction: column; gap: 10px; }
  .zhin-sandbox .agent-playground-run-actions { justify-content: flex-start; }
  .zhin-sandbox .agent-playground-run-actions > button[aria-controls="sandbox-run-inspector"] { display: none; }
  .zhin-sandbox .agent-playground-message-scroll { padding: 20px 12px; }
  .zhin-sandbox .agent-playground-composer { padding: 12px; }
  .zhin-sandbox .agent-playground-composer > div:last-child { max-height: 32px; overflow: hidden; }
  .zhin-sandbox .agent-playground-confirm { padding: 12px; flex-wrap: wrap; }
  .zhin-sandbox .agent-playground-confirm > div { flex-basis: 100%; }
  .zhin-sandbox .agent-playground-run-settings { padding: 12px; max-height: 240px; overflow: auto; }
  .zhin-sandbox .agent-playground-empty { margin-top: 24px; }
  .zhin-sandbox .agent-playground-prompts { flex-direction: column; }
}
`;
