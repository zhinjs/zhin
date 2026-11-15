/**
 * Workspace styles moved from the Console (ADR 0063 D13, step 1). Until P2 the Console shipped them in
 * `console-ui/src/agent-playground.css` (all of it serves only this page) and `im-workspace.css`
 * (only the rules for the classes this page renders: `channel-sidebar`, `chat-area`, `rich-text-editor`,
 * `editor-*` and the `im-markdown-*` / `im-inline-code` / `im-message-link` classes of
 * `@zhin.js/client`'s MarkdownContent), and listed the class names in `remote-entry-style-contract.ts` so
 * its Tailwind build kept them. The page now injects them itself, before `sandboxStyles`, so the cascade is
 * the one the Console produced: every selector is scoped to the page with `:where(.zhin-sandbox)`, which
 * adds no specificity, and the rules stay unlayered as they were in the Console.
 * Plain CSS: no Tailwind utilities, `@apply` or theme functions. Values read the Console theme tokens.
 * Step 2 (the page renders `@zhin.js/console-ui`): element rules skip library controls with
 * `:where(:not(.console-control, [data-state]))` (no added specificity), rules for markup the page no longer
 * renders were removed, and `styles.ts` adds the layout for the components.
 */
export const workspaceStyles = `
/* ---- from zhinjs/console console-ui/src/agent-playground.css ---- */
.agent-playground-shell:where(.zhin-sandbox) {
  --playground-accent: var(--primary);
  --playground-accent-foreground: var(--primary-foreground);
  --playground-accent-soft: var(--accent);
  --playground-line: var(--border);
  display: grid;
  grid-template-columns: minmax(13.5rem, 15.5rem) minmax(0, 1fr);
  width: 100%;
  height: calc(100dvh - var(--console-header-h, 4.5rem) - var(--console-space-page-y, 2rem) - 1rem);
  min-height: 36rem;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: var(--console-radius-xl);
  background: hsl(var(--card));
  box-shadow: var(--console-shadow-sm);
  box-shadow: none;
  isolation: isolate;
}

:where(.zhin-sandbox) .agent-playground-conversation[hidden],
:where(.zhin-sandbox) .agent-playground-composer[hidden] {
  display: none;
}

:where(.zhin-sandbox) .agent-playground-conversation-details {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1rem;
}

:where(.zhin-sandbox) .agent-playground-recovery {
  display: grid;
  flex: none;
  max-height: min(40dvh, 24rem);
  overflow: auto;
  gap: 0.75rem;
  margin: 1rem;
  font-size: var(--console-text-body);
}
:where(.zhin-sandbox) .agent-playground-recovery[hidden] { display: none; }

:where(.zhin-sandbox) .agent-playground-recovery > section,
:where(.zhin-sandbox) .agent-playground-recovery > details {
  min-width: 0;
  padding: 0.875rem;
  border: 1px solid hsl(var(--border));
  border-radius: var(--console-radius-md);
  background: hsl(var(--background));
}

:where(.zhin-sandbox) .agent-playground-recovery h3 { margin-bottom: 0.75rem; font-weight: 600; }
:where(.zhin-sandbox) .agent-playground-recovery summary { display: flex; flex-wrap: wrap; gap: 0.375rem 1rem; align-items: baseline; cursor: pointer; }
:where(.zhin-sandbox) .agent-playground-recovery time { margin-left: auto; font-size: var(--console-text-label); color: hsl(var(--muted-foreground)); }
:where(.zhin-sandbox) .agent-playground-recovery details[open] summary { margin-bottom: 0.875rem; }
:where(.zhin-sandbox) .agent-playground-recovery details > a:where(:not(.console-control, [data-state])) { display: inline-flex; margin: 0.5rem 0.75rem 0 0; color: hsl(var(--primary)); }
:where(.zhin-sandbox) .agent-playground-recovery > p[role=alert],
:where(.zhin-sandbox) .agent-playground-history-navigation p[role=alert] { color: hsl(var(--destructive)); overflow-wrap: anywhere; }
:where(.zhin-sandbox) .agent-playground-recovery > button:where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-recovery > p > button:where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-history-navigation button:where(:not(.console-control, [data-state])) { padding: 0.375rem 0.625rem; border-radius: var(--console-radius-sm); color: hsl(var(--primary)); cursor: pointer; }
:where(.zhin-sandbox) .agent-playground-history-navigation { padding: 0.5rem 1rem; font-size: var(--console-text-label); }
:where(.zhin-sandbox) .agent-playground-history-notice { padding: 0.5rem 1rem; color: hsl(var(--muted-foreground)); text-align: center; font-size: var(--console-text-label); }
:where(.zhin-sandbox) .agent-playground-main:has(> .agent-playground-recovery:not([hidden])) .agent-playground-empty { display: none; }

.agent-playground-shell.has-inspector:where(.zhin-sandbox) {
  grid-template-columns: minmax(13.5rem, 15.5rem) minmax(0, 1fr) minmax(16rem, 19rem);
}

:where(.zhin-sandbox) .agent-playground-mobilebar {
  display: none;
}

:where(.zhin-sandbox) .agent-playground-sessions.channel-sidebar {
  position: relative;
  inset: auto;
  z-index: 2;
  width: auto;
  max-width: none;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  transform: none;
  border: 0;
  border-right: 1px solid hsl(var(--playground-line) / 0.7);
  background: hsl(var(--sidebar));
  box-shadow: none;
}

:where(.zhin-sandbox) .agent-playground-brand {
  padding: 1.25rem 1rem 1rem;
  border-bottom: 1px solid hsl(var(--playground-line) / 0.56);
}

:where(.zhin-sandbox) .agent-playground-brand h2,
:where(.zhin-sandbox) .agent-playground-inspector-head h2,
:where(.zhin-sandbox) .agent-playground-run-title h2,
:where(.zhin-sandbox) .agent-playground-empty h2 {
  margin: 0;
  letter-spacing: -0.025em;
}

:where(.zhin-sandbox) .agent-playground-brand h2 {
  font-size: 0.9rem;
  font-weight: 720;
}

:where(.zhin-sandbox) .agent-playground-brand small {
  display: block;
  margin-top: 0.08rem;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  letter-spacing: 0.04em;
  text-transform: none;
}

:where(.zhin-sandbox) .agent-playground-mark,
:where(.zhin-sandbox) .agent-playground-empty-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--playground-accent));
  background: hsl(var(--playground-accent-soft));
}

:where(.zhin-sandbox) .agent-playground-mark {
  width: 2rem;
  height: 2rem;
  border: 1px solid hsl(var(--playground-accent) / 0.17);
  border-radius: var(--console-radius-md);
}

:where(.zhin-sandbox) .agent-playground-connection {
  display: inline-flex;
  width: 1.75rem;
  height: 1.75rem;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  border-radius: 999px;
  background: hsl(var(--background) / 0.72);
  color: hsl(var(--muted-foreground));
}

:where(.zhin-sandbox) .agent-playground-connection.is-online {
  border-color: hsl(var(--playground-accent) / 0.22);
  color: hsl(var(--playground-accent));
  box-shadow: 0 0 0 3px hsl(var(--playground-accent) / 0.06);
}

:where(.zhin-sandbox) .agent-playground-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 0.85rem 0.45rem;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  font-weight: 680;
  letter-spacing: 0.055em;
  text-transform: none;
}

:where(.zhin-sandbox) .agent-playground-section-label span:last-child {
  font-variant-numeric: tabular-nums;
}

:where(.zhin-sandbox) .agent-playground-session-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 0 0.55rem 0.65rem;
  scrollbar-width: thin;
}

:where(.zhin-sandbox) .agent-playground-session {
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.65rem;
  margin: 0.12rem 0;
  padding: 0.62rem 0.65rem;
  border: 0;
  border-radius: 0.72rem;
  background: transparent;
  color: hsl(var(--foreground));
  text-align: left;
  cursor: pointer;
  transition: background 160ms ease;
}

:where(.zhin-sandbox) .agent-playground-session:hover {
  background: hsl(var(--background) / 0.72);
}

:where(.zhin-sandbox) .agent-playground-session.active {
  background: hsl(var(--background));
  box-shadow: inset 2px 0 hsl(var(--playground-accent));
}

:where(.zhin-sandbox) .agent-playground-session-icon,
:where(.zhin-sandbox) .agent-playground-run-icon,
:where(.zhin-sandbox) .agent-playground-message-avatar {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

:where(.zhin-sandbox) .agent-playground-session-icon {
  width: 2rem;
  height: 2rem;
  border-radius: 0.62rem;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}

:where(.zhin-sandbox) .agent-playground-session.active .agent-playground-session-icon {
  background: hsl(var(--playground-accent-soft));
  color: hsl(var(--playground-accent));
}

:where(.zhin-sandbox) .agent-playground-new-session {
  padding: 0.6rem 0.7rem;
  border-top: 1px solid hsl(var(--playground-line) / 0.56);
}

:where(.zhin-sandbox) .agent-playground-new-form {
  display: grid;
  gap: 0.5rem;
}

:where(.zhin-sandbox) .agent-playground-new-form > input:where(:not(.console-control, [data-state])) {
  min-width: 0;
  height: 2.15rem;
  padding: 0 0.65rem;
  border: 1px solid hsl(var(--border));
  border-radius: 0.62rem;
  outline: 0;
  background: hsl(var(--background) / 0.75);
  color: hsl(var(--foreground));
  font-size: var(--console-text-label);
}

:where(.zhin-sandbox) .agent-playground-new-form > input:focus:where(:not(.console-control, [data-state])) {
  border-color: hsl(var(--playground-accent) / 0.65);
  box-shadow: 0 0 0 3px hsl(var(--playground-accent) / 0.1);
}

:where(.zhin-sandbox) .agent-playground-scope-picker {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.22rem;
  padding: 0.2rem;
  border-radius: 0.58rem;
  background: hsl(var(--muted));
}

:where(.zhin-sandbox) .agent-playground-scope-picker button:where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-new-actions button:where(:not(.console-control, [data-state])) {
  border: 0;
  border-radius: 0.42rem;
  background: transparent;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  cursor: pointer;
}

:where(.zhin-sandbox) .agent-playground-scope-picker button:where(:not(.console-control, [data-state])) {
  min-height: 1.65rem;
}

:where(.zhin-sandbox) .agent-playground-scope-picker button.active:where(:not(.console-control, [data-state])) {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  box-shadow: 0 1px 5px hsl(var(--im-shadow) / 0.1);
}

:where(.zhin-sandbox) .agent-playground-new-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.3rem;
}

:where(.zhin-sandbox) .agent-playground-new-actions button:where(:not(.console-control, [data-state])) {
  min-height: 1.8rem;
  padding: 0 0.65rem;
}

:where(.zhin-sandbox) .agent-playground-new-actions button.primary:where(:not(.console-control, [data-state])) {
  background: hsl(var(--playground-accent));
  color: hsl(var(--playground-accent-foreground));
}

:where(.zhin-sandbox) .agent-playground-endpoint {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.62rem 0.8rem 0.72rem;
  border-top: 1px solid hsl(var(--playground-line) / 0.56);
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
}

:where(.zhin-sandbox) .agent-playground-endpoint strong {
  overflow: hidden;
  color: hsl(var(--foreground) / 0.82);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: var(--console-text-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

:where(.zhin-sandbox) .agent-playground-main.chat-area {
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: hsl(var(--background));
}

:where(.zhin-sandbox) .agent-playground-runbar {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  min-height: 4.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 1rem;
  border-bottom: 1px solid hsl(var(--playground-line) / 0.7);
  background: hsl(var(--background) / 0.9);
  backdrop-filter: blur(14px);
}

:where(.zhin-sandbox) .agent-playground-run-identity {
  display: flex;
  flex: 1 1 14rem;
  min-width: 0;
  align-items: center;
  gap: 0.7rem;
}

:where(.zhin-sandbox) .agent-playground-run-identity > div {
  flex: 1;
  min-width: 0;
}

:where(.zhin-sandbox) .agent-playground-run-icon {
  width: 2.35rem;
  height: 2.35rem;
  border: 1px solid hsl(var(--playground-accent) / 0.18);
  border-radius: var(--console-radius-md);
  background: hsl(var(--playground-accent-soft));
  color: hsl(var(--playground-accent));
}

:where(.zhin-sandbox) .agent-playground-run-title {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
}

:where(.zhin-sandbox) .agent-playground-run-title h2 {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  font-size: 0.95rem;
  font-weight: 730;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:where(.zhin-sandbox) .agent-playground-run-title span {
  flex-shrink: 0;
  padding: 0.16rem 0.4rem;
  border: 1px solid hsl(var(--border));
  border-radius: 999px;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  font-weight: 650;
}

:where(.zhin-sandbox) .agent-playground-run-identity code {
  display: block;
  max-width: 100%;
  margin-top: 0.18rem;
  overflow: hidden;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

:where(.zhin-sandbox) .agent-playground-run-actions {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  margin-left: auto;
  justify-content: flex-end;
  align-items: center;
  gap: 0.28rem;
}

:where(.zhin-sandbox) .agent-playground-run-actions a:where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-run-actions button:where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-inspector-head button:where(:not(.console-control, [data-state])) {
  display: inline-flex;
  min-width: 2rem;
  height: 2rem;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0 0.55rem;
  border: 1px solid hsl(var(--border));
  border-radius: 0.58rem;
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  text-decoration: none;
  cursor: pointer;
}

:where(.zhin-sandbox) .agent-playground-run-actions a:hover:where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-run-actions button:hover:where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-inspector-head button:hover:where(:not(.console-control, [data-state])) {
  border-color: hsl(var(--playground-accent) / 0.32);
  color: hsl(var(--playground-accent));
  background: hsl(var(--playground-accent) / 0.05);
}

:where(.zhin-sandbox) .agent-playground-run-actions button.active:where(:not(.console-control, [data-state])) {
  border-color: hsl(var(--playground-accent) / 0.32);
  background: hsl(var(--playground-accent-soft));
  color: hsl(var(--playground-accent));
}

:where(.zhin-sandbox) .agent-playground-run-state {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-right: 0.2rem;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  white-space: nowrap;
}

:where(.zhin-sandbox) .agent-playground-run-state.is-running {
  color: hsl(var(--playground-accent));
}

:where(.zhin-sandbox) .agent-playground-run-state.is-running svg {
  animation: playground-run-breathe 1.5s ease-in-out infinite;
}

:where(.zhin-sandbox) .agent-playground-run-state.has-problem {
  color: hsl(8 58% 47%);
}

:where(.zhin-sandbox) .agent-playground-run-settings {
  position: relative;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  padding: 0.72rem 0.85rem;
  border-bottom: 1px solid hsl(var(--playground-line) / 0.7);
  background: hsl(var(--sidebar));
  box-shadow: inset 0 1px hsl(var(--background) / 0.7);
}

:where(.zhin-sandbox) .agent-playground-run-settings label {
  display: flex;
  flex: 1 1 8rem;
  min-width: 0;
  flex-direction: column;
  gap: 0.34rem;
}

:where(.zhin-sandbox) .agent-playground-run-settings .agent-playground-directory-field {
  flex-basis: 14rem;
}

:where(.zhin-sandbox) .agent-playground-run-settings label > span {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  font-weight: 650;
}

:where(.zhin-sandbox) .agent-playground-run-settings input[type="text"]:where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-run-settings input:not([type]):where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-run-settings select:where(:not(.console-control, [data-state])) {
  width: 100%;
  min-width: 0;
  height: 2rem;
  padding: 0 0.58rem;
  border: 1px solid hsl(var(--border));
  border-radius: 0.55rem;
  outline: 0;
  background: hsl(var(--background) / 0.84);
  color: hsl(var(--foreground));
  font-size: var(--console-text-label);
}

:where(.zhin-sandbox) .agent-playground-run-settings input:focus:where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-run-settings select:focus:where(:not(.console-control, [data-state])) {
  border-color: hsl(var(--playground-accent) / 0.55);
  box-shadow: 0 0 0 3px hsl(var(--playground-accent) / 0.08);
}

:where(.zhin-sandbox) .agent-playground-run-settings select:disabled:where(:not(.console-control, [data-state])) {
  opacity: 0.58;
  cursor: not-allowed;
}

:where(.zhin-sandbox) .agent-playground-network-toggle {
  position: relative;
  justify-content: flex-end;
  padding-bottom: 0.2rem;
}

:where(.zhin-sandbox) .agent-playground-network-toggle input:where(:not(.console-control, [data-state])) {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

:where(.zhin-sandbox) .agent-playground-network-toggle i {
  position: relative;
  display: block;
  width: 2.2rem;
  height: 1.2rem;
  border: 1px solid hsl(var(--border));
  border-radius: 999px;
  background: hsl(var(--muted));
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease;
}

:where(.zhin-sandbox) .agent-playground-network-toggle i::after {
  position: absolute;
  top: 0.16rem;
  left: 0.17rem;
  width: 0.76rem;
  height: 0.76rem;
  border-radius: 50%;
  background: hsl(var(--background));
  box-shadow: 0 1px 4px hsl(var(--im-shadow) / 0.22);
  content: "";
  transition: transform 160ms ease;
}

:where(.zhin-sandbox) .agent-playground-network-toggle input:checked:where(:not(.console-control, [data-state])) + i {
  border-color: hsl(var(--playground-accent) / 0.45);
  background: hsl(var(--playground-accent));
}

:where(.zhin-sandbox) .agent-playground-network-toggle input:checked:where(:not(.console-control, [data-state])) + i::after {
  transform: translateX(0.96rem);
}

:where(.zhin-sandbox) .agent-playground-network-toggle input:focus-visible:where(:not(.console-control, [data-state])) + i {
  outline: 2px solid hsl(var(--playground-accent));
  outline-offset: 2px;
}

:where(.zhin-sandbox) .agent-playground-run-settings > p {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  padding-top: 0.1rem;
  color: hsl(8 58% 48%);
  font-size: var(--console-text-label);
}

:where(.zhin-sandbox) .agent-playground-conversation {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: hsl(var(--background));
}

:where(.zhin-sandbox) .agent-playground-message-scroll {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

:where(.zhin-sandbox) .agent-playground-empty {
  display: grid;
  width: min(100% - 3rem, 42rem);
  min-height: 100%;
  align-content: center;
  margin: auto;
  padding: 3rem 0;
}

:where(.zhin-sandbox) .agent-playground-empty-mark {
  width: 3.6rem;
  height: 3.6rem;
  margin-bottom: 1.1rem;
  border: 1px solid hsl(var(--playground-accent) / 0.18);
  border-radius: var(--console-radius-lg);
  box-shadow: none;
}

:where(.zhin-sandbox) .agent-playground-empty h2 {
  font-size: clamp(1.25rem, 2.2vw, 1.7rem);
  font-weight: 690;
}

:where(.zhin-sandbox) .agent-playground-empty p {
  max-width: 34rem;
  margin: 0.5rem 0 1.35rem;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-body);
  line-height: 1.65;
}

:where(.zhin-sandbox) .agent-playground-prompts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
}

:where(.zhin-sandbox) .agent-playground-prompts button:where(:not(.console-control, [data-state])) {
  min-height: 4rem;
  padding: 0.72rem;
  border: 1px solid hsl(var(--border));
  border-radius: 0.78rem;
  background: hsl(var(--background) / 0.8);
  color: hsl(var(--foreground) / 0.78);
  font-size: var(--console-text-label);
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  transition: border-color 160ms ease, background-color 160ms ease;
}

:where(.zhin-sandbox) .agent-playground-prompts button:where(:not(.console-control, [data-state]))::after {
  display: block;
  margin-top: 0.45rem;
  color: hsl(var(--playground-accent));
  content: "↗";
}

:where(.zhin-sandbox) .agent-playground-prompts button:hover:where(:not(.console-control, [data-state])) {
  border-color: hsl(var(--playground-accent) / 0.3);
  background: hsl(var(--muted));
}

:where(.zhin-sandbox) .agent-playground-message-list {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  width: min(100% - 2.25rem, 52rem);
  margin: 0 auto;
  padding: 1.5rem 0 2rem;
}

:where(.zhin-sandbox) .agent-playground-message {
  display: flex;
  align-items: flex-start;
  gap: 0.68rem;
}

:where(.zhin-sandbox) .agent-playground-message.is-user {
  flex-direction: row-reverse;
}

:where(.zhin-sandbox) .agent-playground-message-avatar {
  width: 1.9rem;
  height: 1.9rem;
  margin-top: 0.05rem;
  border: 1px solid hsl(var(--border));
  border-radius: 0.63rem;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}

:where(.zhin-sandbox) .agent-playground-message.is-agent .agent-playground-message-avatar {
  border-color: hsl(var(--playground-accent) / 0.18);
  border-radius: var(--console-radius-md);
  background: hsl(var(--playground-accent-soft));
  color: hsl(var(--playground-accent));
}

:where(.zhin-sandbox) .agent-playground-message-main {
  min-width: 0;
  max-width: calc(100% - 3rem);
}

:where(.zhin-sandbox) .agent-playground-message.is-user .agent-playground-message-main {
  max-width: min(76%, 42rem);
}

:where(.zhin-sandbox) .agent-playground-message-meta {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0.12rem 0.3rem;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
}

:where(.zhin-sandbox) .agent-playground-message.is-user .agent-playground-message-meta {
  justify-content: flex-end;
}

:where(.zhin-sandbox) .agent-playground-message-meta strong {
  color: hsl(var(--foreground) / 0.82);
  font-weight: 680;
}

:where(.zhin-sandbox) .agent-playground-message-content {
  overflow: hidden;
  padding: 0.78rem 0.88rem;
  border: 1px solid hsl(var(--border) / 0.78);
  border-radius: var(--console-radius-lg);
  background: hsl(var(--background) / 0.94);
  box-shadow: none;
}

:where(.zhin-sandbox) .agent-playground-message.is-user .agent-playground-message-content {
  border-color: hsl(var(--playground-accent) / 0.2);
  border-radius: var(--console-radius-lg);
  background: hsl(var(--playground-accent-soft));
  box-shadow: none;
}

:where(.zhin-sandbox) .agent-playground-message.is-approval .agent-playground-message-avatar {
  border-color: hsl(38 76% 48% / 0.32);
  background: hsl(38 82% 52% / 0.1);
  color: hsl(34 70% 42%);
}

:where(.zhin-sandbox) .agent-playground-message.is-approval .agent-playground-message-content {
  border-color: hsl(38 76% 48% / 0.32);
  background: hsl(42 82% 97% / 0.9);
  box-shadow: 0 9px 28px hsl(35 60% 30% / 0.075);
}

.dark :where(.zhin-sandbox) .agent-playground-message.is-approval .agent-playground-message-content {
  background: hsl(38 30% 12% / 0.78);
}

:where(.zhin-sandbox) .agent-playground-message.is-approval .agent-playground-message-meta span:last-child {
  padding: 0.12rem 0.36rem;
  border: 1px solid hsl(38 76% 48% / 0.26);
  border-radius: 999px;
  color: hsl(34 70% 40%);
  font-size: var(--console-text-label);
  font-weight: 720;
  letter-spacing: 0.055em;
  text-transform: none;
}

:where(.zhin-sandbox) .agent-playground-approval-actions {
  display: grid;
  gap: 0.45rem;
  margin-top: 0.72rem;
  padding-top: 0.68rem;
  border-top: 1px solid hsl(38 62% 48% / 0.18);
}

:where(.zhin-sandbox) .agent-playground-approval-actions > div {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

:where(.zhin-sandbox) .agent-playground-approval-actions button:where(:not(.console-control, [data-state])) {
  min-height: 1.95rem;
  padding: 0 0.65rem;
  border: 1px solid hsl(var(--border));
  border-radius: 0.48rem;
  background: hsl(var(--background) / 0.78);
  color: hsl(var(--foreground) / 0.8);
  font-size: var(--console-text-label);
  font-weight: 650;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease;
}

:where(.zhin-sandbox) .agent-playground-approval-actions button:hover:not(:disabled):where(:not(.console-control, [data-state])) {
  border-color: hsl(var(--playground-accent) / 0.38);
  color: hsl(var(--playground-accent));
  transform: translateY(-1px);
}

:where(.zhin-sandbox) .agent-playground-approval-actions button.is-primary:where(:not(.console-control, [data-state])) {
  border-color: hsl(var(--playground-accent) / 0.36);
  background: hsl(var(--playground-accent));
  color: hsl(var(--playground-accent-foreground));
}

:where(.zhin-sandbox) .agent-playground-approval-actions button.is-danger:where(:not(.console-control, [data-state])) {
  border-color: hsl(8 62% 52% / 0.25);
  color: hsl(8 58% 46%);
}

:where(.zhin-sandbox) .agent-playground-approval-actions button:disabled:where(:not(.console-control, [data-state])) {
  cursor: not-allowed;
  opacity: 0.48;
}

:where(.zhin-sandbox) .agent-playground-approval-actions small {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: hsl(var(--playground-accent));
  font-size: var(--console-text-label);
}

:where(.zhin-sandbox) .agent-playground-message-content > :first-child,
:where(.zhin-sandbox) .agent-playground-message-content .zhin-markdown > :first-child { margin-top: 0; }
:where(.zhin-sandbox) .agent-playground-message-content > :last-child,
:where(.zhin-sandbox) .agent-playground-message-content .zhin-markdown > :last-child { margin-bottom: 0; }

:where(.zhin-sandbox) .agent-playground-message-content .zhin-code-block {
  max-width: 100%;
  margin-right: -0.2rem;
  margin-left: -0.2rem;
}

:where(.zhin-sandbox) .agent-playground-inline-run {
  position: relative;
  overflow: hidden;
  margin-left: 2.58rem;
  border: 1px solid hsl(var(--playground-line) / 0.82);
  border-radius: var(--console-radius-lg);
  background: hsl(var(--background) / 0.86);
  box-shadow: none;
}

.dark :where(.zhin-sandbox) .agent-playground-inline-run {
  background: hsl(var(--card) / 0.72);
}

:where(.zhin-sandbox) .agent-playground-inline-run-rail {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: hsl(var(--playground-accent));
}

:where(.zhin-sandbox) .agent-playground-inline-run.is-running .agent-playground-inline-run-rail { background: hsl(190 62% 46%); }
:where(.zhin-sandbox) .agent-playground-inline-run.is-failed .agent-playground-inline-run-rail { background: hsl(8 62% 52%); }
:where(.zhin-sandbox) .agent-playground-inline-run.is-cancelled .agent-playground-inline-run-rail { background: hsl(38 76% 48%); }

:where(.zhin-sandbox) .agent-playground-inline-run-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.72rem;
  padding: 0.9rem 0.95rem 0.8rem 1rem;
}

:where(.zhin-sandbox) .agent-playground-inline-run-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.2rem;
  height: 2.2rem;
  border: 1px solid hsl(var(--playground-accent) / 0.18);
  border-radius: 0.68rem;
  background: hsl(var(--playground-accent-soft));
  color: hsl(var(--playground-accent));
}

:where(.zhin-sandbox) .agent-playground-inline-run.is-running .agent-playground-inline-run-icon {
  border-color: hsl(190 62% 46% / 0.24);
  background: hsl(190 62% 46% / 0.09);
  color: hsl(190 62% 40%);
}

:where(.zhin-sandbox) .agent-playground-inline-run-copy { min-width: 0; }
:where(.zhin-sandbox) .agent-playground-inline-run-copy > span {
  display: block;
  margin-bottom: 0.15rem;
  color: hsl(var(--muted-foreground) / 0.76);
  font-size: var(--console-text-label);
  font-weight: 750;
  letter-spacing: 0.11em;
  text-transform: none;
}

:where(.zhin-sandbox) .agent-playground-inline-run-copy h3 {
  margin: 0;
  color: hsl(var(--foreground) / 0.91);
  font-size: var(--console-text-body);
  font-weight: 710;
  letter-spacing: -0.012em;
}

:where(.zhin-sandbox) .agent-playground-inline-run-copy p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0.2rem 0 0;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

:where(.zhin-sandbox) .agent-playground-inline-run-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.35rem;
}

:where(.zhin-sandbox) .agent-playground-inline-run-actions button:where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-inline-run footer button:where(:not(.console-control, [data-state])) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.28rem;
  min-height: 1.82rem;
  padding: 0 0.55rem;
  border: 1px solid hsl(var(--border) / 0.82);
  border-radius: 0.48rem;
  background: hsl(var(--background) / 0.72);
  color: hsl(var(--foreground) / 0.73);
  font-size: var(--console-text-label);
  font-weight: 660;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease, background 140ms ease, transform 140ms ease;
}

:where(.zhin-sandbox) .agent-playground-inline-run-actions button:hover:not(:disabled):where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-inline-run footer button:hover:where(:not(.console-control, [data-state])) {
  border-color: hsl(var(--playground-accent) / 0.36);
  color: hsl(var(--playground-accent));
  transform: translateY(-1px);
}

:where(.zhin-sandbox) .agent-playground-inline-run-actions button.is-stop:where(:not(.console-control, [data-state])) {
  border-color: hsl(8 62% 52% / 0.23);
  color: hsl(8 58% 47%);
}

:where(.zhin-sandbox) .agent-playground-inline-run-actions button:disabled:where(:not(.console-control, [data-state])) { cursor: wait; opacity: 0.55; }

:where(.zhin-sandbox) .agent-playground-inline-run-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 0;
  border-top: 1px solid hsl(var(--playground-line) / 0.62);
  border-bottom: 1px solid hsl(var(--playground-line) / 0.62);
  background: hsl(var(--muted) / 0.22);
}

:where(.zhin-sandbox) .agent-playground-inline-run-metrics > div {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.48rem 0.35rem;
  border-right: 1px solid hsl(var(--playground-line) / 0.48);
}

:where(.zhin-sandbox) .agent-playground-inline-run-metrics > div:last-child { border-right: 0; }
:where(.zhin-sandbox) .agent-playground-inline-run-metrics dt { color: hsl(var(--muted-foreground)); font-size: var(--console-text-label); }
:where(.zhin-sandbox) .agent-playground-inline-run-metrics dd { overflow: hidden; margin: 0; font-size: var(--console-text-label); font-weight: 680; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
:where(.zhin-sandbox) .agent-playground-inline-run-metrics .has-problem dd { color: hsl(8 58% 48%); }

:where(.zhin-sandbox) .agent-playground-inline-run-steps {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0.45rem 0.95rem 0.45rem 1.08rem;
  list-style: none;
}

:where(.zhin-sandbox) .agent-playground-inline-run-steps li {
  position: relative;
  display: grid;
  grid-template-columns: 0.75rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.46rem;
  min-height: 2.05rem;
}

:where(.zhin-sandbox) .agent-playground-inline-run-steps li:not(:last-child)::after {
  position: absolute;
  z-index: 0;
  top: 1.18rem;
  bottom: -0.86rem;
  left: 0.28rem;
  width: 1px;
  background: hsl(var(--playground-line));
  content: "";
}

:where(.zhin-sandbox) .agent-playground-inline-run-steps i {
  position: relative;
  z-index: 1;
  width: 0.58rem;
  height: 0.58rem;
  border: 2px solid hsl(var(--background));
  border-radius: 50%;
  background: hsl(var(--playground-accent));
  box-shadow: 0 0 0 1px hsl(var(--playground-accent) / 0.28);
}

:where(.zhin-sandbox) .agent-playground-inline-run-steps li.is-running i {
  background: hsl(190 62% 46%);
  box-shadow: 0 0 0 1px hsl(190 62% 46% / 0.34);
  animation: playground-run-breathe 1.4s ease-in-out infinite;
}

:where(.zhin-sandbox) .agent-playground-inline-run-steps li.is-failed i,
:where(.zhin-sandbox) .agent-playground-inline-run-steps li.is-denied i { background: hsl(8 62% 52%); box-shadow: 0 0 0 1px hsl(8 62% 52% / 0.3); }
:where(.zhin-sandbox) .agent-playground-inline-run-steps li.is-cancelled i { background: hsl(38 76% 48%); box-shadow: 0 0 0 1px hsl(38 76% 48% / 0.3); }
:where(.zhin-sandbox) .agent-playground-inline-run-steps li > div { display: flex; min-width: 0; flex-direction: column; }
:where(.zhin-sandbox) .agent-playground-inline-run-steps strong { overflow: hidden; color: hsl(var(--foreground) / 0.82); font-size: var(--console-text-label); font-weight: 660; text-overflow: ellipsis; white-space: nowrap; }
:where(.zhin-sandbox) .agent-playground-inline-run-steps small { overflow: hidden; color: hsl(var(--muted-foreground)); font-size: var(--console-text-label); text-overflow: ellipsis; white-space: nowrap; }
:where(.zhin-sandbox) .agent-playground-inline-run-steps li > span { color: hsl(var(--muted-foreground)); font-size: var(--console-text-label); font-variant-numeric: tabular-nums; }
:where(.zhin-sandbox) .agent-playground-inline-run-steps li.is-failed > span,
:where(.zhin-sandbox) .agent-playground-inline-run-steps li.is-denied > span { color: hsl(8 58% 48%); }

:where(.zhin-sandbox) .agent-playground-inline-run-empty {
  padding: 0.72rem 1rem;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  text-align: center;
}

:where(.zhin-sandbox) .agent-playground-inline-run footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.95rem 0.6rem 1rem;
}

:where(.zhin-sandbox) .agent-playground-inline-run footer button:where(:not(.console-control, [data-state])) {
  min-height: auto;
  padding: 0.15rem 0;
  border: 0;
  background: transparent;
  color: hsl(var(--muted-foreground));
}

:where(.zhin-sandbox) .agent-playground-inline-run footer button:first-child:where(:not(.console-control, [data-state])) svg { transition: transform 150ms ease; }
:where(.zhin-sandbox) .agent-playground-inline-run footer button:first-child[aria-expanded="true"]:where(:not(.console-control, [data-state])) svg { transform: rotate(180deg); }

:where(.zhin-sandbox) .agent-playground-composer {
  position: relative;
  z-index: 2;
  display: grid;
  gap: 0.58rem;
  padding: 0.72rem 0.85rem 0.65rem;
  border-top: 1px solid hsl(var(--playground-line) / 0.74);
  background: hsl(var(--background) / 0.94);
  box-shadow: none;
  backdrop-filter: blur(16px);
}

:where(.zhin-sandbox) .agent-playground-composer .rich-text-editor,
:where(.zhin-sandbox) .agent-playground-composer .sandbox-markdown-preview {
  min-height: 3rem !important;
  border-color: hsl(var(--border) / 0.86) !important;
  border-radius: var(--console-radius-lg) !important;
  background-color: hsl(var(--muted) / 0.24);
}

:where(.zhin-sandbox) .agent-playground-composer .rich-text-editor {
  padding: 0.72rem 0.8rem !important;
}

:where(.zhin-sandbox) .agent-playground-composer .rich-text-editor:focus {
  border-color: hsl(var(--playground-accent) / 0.52) !important;
  box-shadow: 0 0 0 3px hsl(var(--playground-accent) / 0.08);
}

:where(.zhin-sandbox) .agent-playground-composer > div:last-child {
  opacity: 0.75;
}

:where(.zhin-sandbox) .agent-playground-inspector {
  display: none;
  min-width: 0;
  height: 100%;
  flex-direction: column;
  overflow-y: auto;
  border-left: 1px solid hsl(var(--playground-line) / 0.7);
  background:
    hsl(var(--muted) / 0.25);
  scrollbar-width: thin;
}

:where(.zhin-sandbox) .agent-playground-inspector.show {
  display: flex;
}

:where(.zhin-sandbox) .agent-playground-inspector-head {
  display: flex;
  min-height: 4.75rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid hsl(var(--playground-line) / 0.65);
}

:where(.zhin-sandbox) .agent-playground-inspector-head > div:last-child {
  display: flex;
  gap: 0.3rem;
}

:where(.zhin-sandbox) .agent-playground-inspector-head > div:first-child > span {
  color: hsl(var(--playground-accent));
  font-size: var(--console-text-label);
  font-weight: 720;
  letter-spacing: 0.08em;
  text-transform: none;
}

:where(.zhin-sandbox) .agent-playground-inspector-head h2 {
  margin-top: 0.08rem;
  font-size: 0.88rem;
  font-weight: 710;
}

:where(.zhin-sandbox) .agent-playground-inspector-head button:where(:not(.console-control, [data-state])) {
  padding: 0;
}

:where(.zhin-sandbox) .agent-playground-inspector-view {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

:where(.zhin-sandbox) .agent-playground-inspector-view.hidden {
  display: none;
}

:where(.zhin-sandbox) .agent-playground-inspector-section {
  padding: 0.85rem;
  border-bottom: 1px solid hsl(var(--playground-line) / 0.58);
}

:where(.zhin-sandbox) .agent-playground-inspector-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.62rem;
  color: hsl(var(--foreground) / 0.82);
  font-size: var(--console-text-label);
  font-weight: 680;
}

:where(.zhin-sandbox) .agent-playground-inspector-title small {
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  font-weight: 550;
  letter-spacing: 0.05em;
  text-transform: none;
}

:where(.zhin-sandbox) .agent-playground-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 1px solid hsl(var(--border) / 0.72);
  border-radius: 0.78rem;
  overflow: hidden;
  background: hsl(var(--background) / 0.55);
}

:where(.zhin-sandbox) .agent-playground-metrics > div {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.08rem 0.4rem;
  min-width: 0;
  padding: 0.62rem;
}

:where(.zhin-sandbox) .agent-playground-metrics > div:nth-child(odd) { border-right: 1px solid hsl(var(--border) / 0.62); }
:where(.zhin-sandbox) .agent-playground-metrics > div:nth-child(-n+2) { border-bottom: 1px solid hsl(var(--border) / 0.62); }
:where(.zhin-sandbox) .agent-playground-metrics svg { grid-row: span 2; width: 0.78rem; color: hsl(var(--playground-accent)); }
:where(.zhin-sandbox) .agent-playground-metrics strong { overflow: hidden; font-size: var(--console-text-body); font-variant-numeric: tabular-nums; text-overflow: ellipsis; }
:where(.zhin-sandbox) .agent-playground-metrics span { color: hsl(var(--muted-foreground)); font-size: var(--console-text-label); }
:where(.zhin-sandbox) .agent-playground-metrics .has-problem svg,
:where(.zhin-sandbox) .agent-playground-metrics .has-problem strong { color: hsl(8 62% 52%); }

:where(.zhin-sandbox) .agent-playground-context-list {
  display: grid;
  gap: 0;
  margin: 0;
}

:where(.zhin-sandbox) .agent-playground-context-list > div {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.36rem 0;
  border-bottom: 1px dashed hsl(var(--border) / 0.6);
  font-size: var(--console-text-label);
}

:where(.zhin-sandbox) .agent-playground-context-list > div:last-child { border-bottom: 0; }
:where(.zhin-sandbox) .agent-playground-context-list dt { color: hsl(var(--muted-foreground)); }
:where(.zhin-sandbox) .agent-playground-context-list dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: hsl(var(--foreground) / 0.82);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:where(.zhin-sandbox) .agent-playground-context-list dd.is-online { color: hsl(var(--playground-accent)); }

:where(.zhin-sandbox) .agent-playground-trace-section {
  flex: 1;
}

:where(.zhin-sandbox) .agent-playground-trace-list {
  position: relative;
  display: grid;
  gap: 0;
}

:where(.zhin-sandbox) .agent-playground-trace-list::before {
  position: absolute;
  top: 0.55rem;
  bottom: 0.55rem;
  left: 0.26rem;
  width: 1px;
  background: hsl(var(--border));
  content: "";
}

:where(.zhin-sandbox) .agent-playground-trace-item {
  position: relative;
  display: grid;
  grid-template-columns: 0.55rem minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: start;
  padding: 0.42rem 0;
}

:where(.zhin-sandbox) .agent-playground-trace-dot {
  position: relative;
  z-index: 1;
  width: 0.52rem;
  height: 0.52rem;
  margin-top: 0.18rem;
  border: 2px solid hsl(var(--muted));
  border-radius: 50%;
  background: hsl(var(--muted-foreground));
  box-shadow: 0 0 0 1px hsl(var(--border));
}

:where(.zhin-sandbox) .agent-playground-trace-item.is-success .agent-playground-trace-dot { background: hsl(var(--playground-accent)); }
:where(.zhin-sandbox) .agent-playground-trace-item.is-running .agent-playground-trace-dot { background: hsl(190 62% 46%); }
:where(.zhin-sandbox) .agent-playground-trace-item.is-thinking .agent-playground-trace-dot { background: hsl(221 70% 58%); }
:where(.zhin-sandbox) .agent-playground-trace-item.is-tool .agent-playground-trace-dot { background: hsl(275 50% 57%); }
:where(.zhin-sandbox) .agent-playground-trace-item.is-capability .agent-playground-trace-dot { background: hsl(38 84% 52%); }
:where(.zhin-sandbox) .agent-playground-trace-item.is-usage .agent-playground-trace-dot { background: hsl(184 52% 42%); }
:where(.zhin-sandbox) .agent-playground-trace-item.is-problem .agent-playground-trace-dot { background: hsl(8 62% 52%); }
:where(.zhin-sandbox) .agent-playground-trace-item > div { display: flex; min-width: 0; flex-direction: column; }
:where(.zhin-sandbox) .agent-playground-trace-item strong { overflow: hidden; font-size: var(--console-text-label); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
:where(.zhin-sandbox) .agent-playground-trace-item small { overflow: hidden; color: hsl(var(--muted-foreground)); font-size: var(--console-text-label); text-overflow: ellipsis; white-space: nowrap; }
:where(.zhin-sandbox) .agent-playground-trace-item time { margin-top: 0.03rem; color: hsl(var(--muted-foreground)); font-size: var(--console-text-label); font-variant-numeric: tabular-nums; }

:where(.zhin-sandbox) .agent-playground-trace-loading,
:where(.zhin-sandbox) .agent-playground-trace-empty,
:where(.zhin-sandbox) .agent-playground-trace-notice {
  display: flex;
  min-height: 5rem;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px dashed hsl(var(--border));
  border-radius: 0.72rem;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  text-align: center;
}

:where(.zhin-sandbox) .agent-playground-trace-loading i {
  width: 0.35rem;
  height: 0.35rem;
  border-radius: 50%;
  background: hsl(var(--playground-accent));
  animation: playground-trace-pulse 900ms ease-in-out infinite alternate;
}

:where(.zhin-sandbox) .agent-playground-trace-loading i:nth-child(2) { animation-delay: 150ms; }
:where(.zhin-sandbox) .agent-playground-trace-loading i:nth-child(3) { animation-delay: 300ms; }
:where(.zhin-sandbox) .agent-playground-trace-notice { padding: 0.75rem; border-color: hsl(38 84% 52% / 0.42); color: hsl(32 70% 38%); }

:where(.zhin-sandbox) .agent-playground-task-section,
:where(.zhin-sandbox) .agent-playground-artifact-section {
  flex: 0 0 auto;
}

:where(.zhin-sandbox) .agent-playground-artifact-section {
  flex: 1 0 auto;
}

:where(.zhin-sandbox) .agent-playground-task-list,
:where(.zhin-sandbox) .agent-playground-artifact-list {
  display: grid;
  gap: 0.5rem;
}

:where(.zhin-sandbox) .agent-playground-task-list article {
  display: grid;
  grid-template-columns: 0.6rem minmax(0, 1fr);
  gap: 0.12rem 0.46rem;
  padding: 0.62rem 0.65rem;
  border: 1px solid hsl(var(--border) / 0.72);
  border-radius: 0.7rem;
  background: hsl(var(--background) / 0.58);
}

:where(.zhin-sandbox) .agent-playground-task-list article > i {
  width: 0.5rem;
  height: 0.5rem;
  margin-top: 0.2rem;
  border: 2px solid hsl(var(--muted));
  border-radius: 50%;
  background: hsl(var(--muted-foreground));
  box-shadow: 0 0 0 1px hsl(var(--border));
}

:where(.zhin-sandbox) .agent-playground-task-list article.is-running > i { background: hsl(190 62% 46%); }
:where(.zhin-sandbox) .agent-playground-task-list article.is-completed > i { background: hsl(var(--playground-accent)); }
:where(.zhin-sandbox) .agent-playground-task-list article.is-failed > i { background: hsl(8 62% 52%); }
:where(.zhin-sandbox) .agent-playground-task-list article.is-cancelled > i { background: hsl(38 76% 48%); }
:where(.zhin-sandbox) .agent-playground-task-list article > div { display: flex; min-width: 0; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
:where(.zhin-sandbox) .agent-playground-task-list strong { font-size: var(--console-text-label); font-weight: 680; }
:where(.zhin-sandbox) .agent-playground-task-list code { overflow: hidden; color: hsl(var(--muted-foreground)); font-size: var(--console-text-label); text-overflow: ellipsis; }

:where(.zhin-sandbox) .agent-playground-task-list dl {
  display: grid;
  grid-column: 2;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0.45rem 0 0;
  padding-top: 0.45rem;
  border-top: 1px dashed hsl(var(--border) / 0.72);
}

:where(.zhin-sandbox) .agent-playground-task-list dl > div { display: flex; flex-direction: column; gap: 0.06rem; }
:where(.zhin-sandbox) .agent-playground-task-list dt { color: hsl(var(--muted-foreground)); font-size: var(--console-text-label); }
:where(.zhin-sandbox) .agent-playground-task-list dd { margin: 0; font-size: var(--console-text-label); font-variant-numeric: tabular-nums; }

:where(.zhin-sandbox) .agent-playground-artifact-list article {
  overflow: hidden;
  border: 1px solid hsl(var(--border) / 0.72);
  border-radius: 0.68rem;
  background: hsl(var(--background) / 0.6);
}

:where(.zhin-sandbox) .agent-playground-artifact-list article.is-expanded {
  border-color: hsl(var(--playground-accent) / 0.28);
  box-shadow: 0 8px 24px hsl(var(--im-shadow) / 0.055);
}

:where(.zhin-sandbox) .agent-playground-artifact-list article > button:where(:not(.console-control, [data-state])) {
  display: grid;
  width: 100%;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: 0.48rem;
  align-items: center;
  padding: 0.58rem 0.62rem;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

:where(.zhin-sandbox) .agent-playground-artifact-icon {
  display: inline-flex;
  width: 1.65rem;
  height: 1.65rem;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--playground-accent) / 0.18);
  border-radius: 0.48rem;
  background: hsl(var(--playground-accent-soft));
  color: hsl(var(--playground-accent));
}

:where(.zhin-sandbox) .agent-playground-artifact-list article > button:where(:not(.console-control, [data-state])) > span:nth-child(2) { display: flex; min-width: 0; flex-direction: column; }
:where(.zhin-sandbox) .agent-playground-artifact-list strong,
:where(.zhin-sandbox) .agent-playground-artifact-list small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:where(.zhin-sandbox) .agent-playground-artifact-list strong { font-size: var(--console-text-label); font-weight: 660; }
:where(.zhin-sandbox) .agent-playground-artifact-list small { color: hsl(var(--muted-foreground)); font-size: var(--console-text-label); }
:where(.zhin-sandbox) .agent-playground-artifact-list em { color: hsl(var(--muted-foreground)); font-size: var(--console-text-label); font-style: normal; text-transform: none; }
:where(.zhin-sandbox) .agent-playground-artifact-list article.is-completed em { color: hsl(var(--playground-accent)); }
:where(.zhin-sandbox) .agent-playground-artifact-list article.is-failed em,
:where(.zhin-sandbox) .agent-playground-artifact-list article.is-denied em { color: hsl(8 58% 47%); }
:where(.zhin-sandbox) .agent-playground-artifact-list article > button:where(:not(.console-control, [data-state])) > svg { color: hsl(var(--muted-foreground)); transition: transform 160ms ease; }
:where(.zhin-sandbox) .agent-playground-artifact-list article.is-expanded > button:where(:not(.console-control, [data-state])) > svg { transform: rotate(180deg); }

:where(.zhin-sandbox) .agent-playground-artifact-detail {
  display: grid;
  gap: 0.45rem;
  padding: 0 0.62rem 0.62rem 2.75rem;
}

:where(.zhin-sandbox) .agent-playground-artifact-detail > code {
  overflow-wrap: anywhere;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
}

:where(.zhin-sandbox) .agent-playground-artifact-detail pre {
  max-height: 15rem;
  margin: 0;
  overflow: auto;
  padding: 0.62rem;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: 0.48rem;
  background: hsl(220 18% 10%);
  color: hsl(210 25% 91%);
  font-size: var(--console-text-label);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

:where(.zhin-sandbox) .agent-playground-artifact-detail footer {
  display: flex;
  justify-content: space-between;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
}

:where(.zhin-sandbox) .agent-playground-artifact-empty {
  display: flex;
  min-height: 6.5rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 1rem;
  border: 1px dashed hsl(var(--border));
  border-radius: 0.72rem;
  color: hsl(var(--muted-foreground));
  font-size: var(--console-text-label);
  line-height: 1.45;
  text-align: center;
}

:where(.zhin-sandbox) .agent-playground-studio-link {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  gap: 0.28rem;
  margin: 0.85rem;
  padding: 0.7rem;
  border: 1px solid hsl(var(--playground-accent) / 0.2);
  border-radius: 0.72rem;
  background: hsl(var(--playground-accent-soft));
  color: hsl(var(--playground-accent));
  text-decoration: none;
}

:where(.zhin-sandbox) .agent-playground-studio-link > span { display: flex; align-items: center; gap: 0.4rem; font-size: var(--console-text-label); font-weight: 680; }
:where(.zhin-sandbox) .agent-playground-studio-link code { overflow: hidden; opacity: 0.7; font-size: var(--console-text-label); text-overflow: ellipsis; white-space: nowrap; }
:where(.zhin-sandbox) .agent-playground-studio-link:hover { border-color: hsl(var(--playground-accent) / 0.42); }

:where(.zhin-sandbox) .agent-playground-inspector-overlay { display: none; }

.agent-playground-shell:where(.zhin-sandbox) button:focus-visible:where(:not(.console-control, [data-state])), .agent-playground-shell:where(.zhin-sandbox) a:focus-visible:where(:not(.console-control, [data-state])), .agent-playground-shell:where(.zhin-sandbox) input:focus-visible:where(:not(.console-control, [data-state])) {
  outline: 2px solid hsl(var(--playground-accent));
  outline-offset: 2px;
}

@keyframes playground-trace-pulse {
  from { opacity: 0.25; transform: translateY(1px); }
  to { opacity: 1; transform: translateY(-1px); }
}

@keyframes playground-run-breathe {
  0%, 100% { opacity: 0.52; transform: scale(0.92); }
  50% { opacity: 1; transform: scale(1); }
}

@media (max-width: 1440px) {
  .agent-playground-shell:where(.zhin-sandbox),
  .agent-playground-shell.has-inspector:where(.zhin-sandbox) {
    grid-template-columns: minmax(13.5rem, 15rem) minmax(0, 1fr);
  }

  :where(.zhin-sandbox) .agent-playground-inspector {
    position: fixed;
    z-index: 1201;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(22rem, 90vw);
    height: 100dvh;
    transform: translateX(105%);
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: -16px 0 50px hsl(var(--im-shadow) / 0.2);
  }

  :where(.zhin-sandbox) .agent-playground-inspector.show { transform: translateX(0); }
  :where(.zhin-sandbox) .agent-playground-inspector-overlay {
    position: fixed;
    z-index: 1200;
    inset: 0;
    display: block;
    background: hsl(220 20% 5% / 0.42);
    backdrop-filter: blur(2px);
  }

}

@media (max-width: 1180px) {
  .agent-playground-shell:where(.zhin-sandbox),
  .agent-playground-shell.has-inspector:where(.zhin-sandbox) {
    position: relative;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  :where(.zhin-sandbox) .agent-playground-mobilebar {
    display: grid;
    grid-column: 1;
    grid-row: 1;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    min-height: 2.65rem;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid hsl(var(--border));
    background: hsl(var(--background));
  }

  :where(.zhin-sandbox) .agent-playground-mobilebar strong { font-size: var(--console-text-label); }
  :where(.zhin-sandbox) .agent-playground-mobilebar button:where(:not(.console-control, [data-state])) {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    justify-self: start;
    padding: 0.4rem;
    border: 0;
    background: transparent;
    color: hsl(var(--muted-foreground));
    font-size: var(--console-text-label);
    cursor: pointer;
  }
  :where(.zhin-sandbox) .agent-playground-mobilebar button:last-child:where(:not(.console-control, [data-state])) { justify-self: end; }

  :where(.zhin-sandbox) .agent-playground-sessions.channel-sidebar {
    position: fixed;
    z-index: 1201;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(19rem, 88vw);
    max-width: 88vw;
    height: 100dvh;
    transform: translateX(-105%);
    visibility: hidden;
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: 16px 0 50px hsl(var(--im-shadow) / 0.2);
  }

  :where(.zhin-sandbox) .agent-playground-sessions.channel-sidebar.show { transform: translateX(0); visibility: visible; }
  .agent-playground-shell:where(.zhin-sandbox) .channel-overlay {
    position: fixed;
    z-index: 1200;
    inset: 0;
    display: block;
    background: hsl(220 20% 5% / 0.42);
    backdrop-filter: blur(2px);
  }

  :where(.zhin-sandbox) .agent-playground-main.chat-area {
    grid-column: 1;
    grid-row: 2;
    padding: 0;
  }

  :where(.zhin-sandbox) .agent-playground-network-toggle { justify-content: center; }
}

@media (max-width: 900px) {
  .agent-playground-shell:where(.zhin-sandbox) {
    height: calc(100dvh - var(--console-header-h, 4.5rem) - var(--console-space-page-y, 2rem) - 1rem);
    min-height: 32rem;
    border-radius: 0.85rem;
  }

  :where(.zhin-sandbox) .agent-playground-run-actions a:where(:not(.console-control, [data-state])), :where(.zhin-sandbox) .agent-playground-run-state { display: none; }
}

@media (max-width: 640px) {
  .agent-playground-shell:where(.zhin-sandbox) {
    height: calc(100dvh - var(--console-header-h, 4.5rem) - var(--console-space-page-y, 2rem) - 1rem);
    min-height: 29rem;
    border-right: 0;
    border-left: 0;
    border-radius: 0;
  }

  :where(.zhin-sandbox) .agent-playground-runbar {
    min-height: 4.1rem;
    gap: 0.55rem;
    padding: 0.6rem 0.7rem;
  }

  :where(.zhin-sandbox) .agent-playground-run-icon { width: 2.05rem; height: 2.05rem; }
  :where(.zhin-sandbox) .agent-playground-run-title span { display: none; }
  :where(.zhin-sandbox) .agent-playground-run-actions { flex-wrap: nowrap; gap: 0.25rem; }
  :where(.zhin-sandbox) .agent-playground-run-actions button:where(:not(.console-control, [data-state])) {
    flex-shrink: 0;
    width: 2rem;
    min-width: 2rem;
    height: 2rem;
    gap: 0;
    padding: 0;
    font-size: 0;
  }

  :where(.zhin-sandbox) .agent-playground-run-settings {
    max-height: 16rem;
    overflow-y: auto;
    padding: 0.65rem;
  }

  :where(.zhin-sandbox) .agent-playground-network-toggle { align-items: flex-start; }

  :where(.zhin-sandbox) .agent-playground-empty {
    width: min(100% - 1.5rem, 32rem);
    padding: 2rem 0;
  }

  :where(.zhin-sandbox) .agent-playground-prompts { grid-template-columns: 1fr; }
  :where(.zhin-sandbox) .agent-playground-prompts button:where(:not(.console-control, [data-state])) { min-height: 2.8rem; }
  :where(.zhin-sandbox) .agent-playground-message-list { width: calc(100% - 1rem); padding-top: 1rem; }
  :where(.zhin-sandbox) .agent-playground-message-avatar { width: 1.75rem; height: 1.75rem; }
  :where(.zhin-sandbox) .agent-playground-message-main { max-width: calc(100% - 2.35rem); }
  :where(.zhin-sandbox) .agent-playground-message.is-user .agent-playground-message-main { max-width: 84%; }
  :where(.zhin-sandbox) .agent-playground-message-content { padding: 0.65rem 0.72rem; }
  :where(.zhin-sandbox) .agent-playground-inline-run { margin-left: 0; }
  :where(.zhin-sandbox) .agent-playground-inline-run-head { grid-template-columns: auto minmax(0, 1fr); padding: 0.8rem 0.75rem 0.68rem 0.82rem; }
  :where(.zhin-sandbox) .agent-playground-inline-run-actions { grid-column: 1 / -1; justify-content: flex-start; padding-left: 2.92rem; }
  :where(.zhin-sandbox) .agent-playground-inline-run-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  :where(.zhin-sandbox) .agent-playground-inline-run-metrics > div:nth-child(3) { border-right: 0; }
  :where(.zhin-sandbox) .agent-playground-inline-run-metrics > div:nth-child(n+4) { border-top: 1px solid hsl(var(--playground-line) / 0.48); }
  :where(.zhin-sandbox) .agent-playground-inline-run-metrics > div:nth-child(4) { grid-column: span 2; }
  :where(.zhin-sandbox) .agent-playground-inline-run footer { align-items: flex-start; flex-direction: column; }

  :where(.zhin-sandbox) .agent-playground-composer { padding: 0.6rem; }
  :where(.zhin-sandbox) .agent-playground-composer > div:first-child > .flex-1 { display: none; }
  :where(.zhin-sandbox) .agent-playground-composer > div:last-child { display: none; }
  :where(.zhin-sandbox) .agent-playground-composer .zhin-code-block { min-width: min(20rem, 78vw); }
}

@media (prefers-reduced-motion: reduce) {
  .agent-playground-shell:where(.zhin-sandbox) *,
  :where(.zhin-sandbox) .agent-playground-trace-loading i {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
.console-route-view .zhin-sandbox.agent-playground-shell {
  border-radius: var(--console-radius-xl);
  box-shadow: var(--console-shadow-sm);
  font-size: var(--console-text-body);
}
.console-route-view .zhin-sandbox .sandbox-hints {
  flex-wrap: nowrap;
  overflow-x: auto;
  white-space: nowrap;
  font-size: var(--console-text-caption);
  color: hsl(var(--muted-foreground));
  scrollbar-width: none;
}
.console-route-view .zhin-sandbox .sandbox-hints::-webkit-scrollbar { display: none; }
.console-route-view .zhin-sandbox .sandbox-hint-key { font-size: var(--console-text-caption); }
.console-route-view .zhin-sandbox .agent-playground-run-actions { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }

/* ---- from zhinjs/console console-ui/src/im-workspace.css (only the rules the Sandbox DOM uses) ---- */
:where(.zhin-sandbox) .channel-sidebar { display: flex; flex-direction: column; flex-shrink: 0; min-height: 0; }
:where(.zhin-sandbox) .chat-area { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
:where(.zhin-sandbox) .im-segment-list, :where(.zhin-sandbox) .im-markdown-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
:where(.zhin-sandbox) .im-message-link { color: hsl(var(--primary)); overflow-wrap: anywhere; text-decoration: underline; text-underline-offset: 3px; }
:where(.zhin-sandbox) .im-inline-code { padding: 1px 4px; border: 1px solid hsl(var(--border)); border-radius: 4px; background: hsl(var(--muted)); font-family: var(--console-font-mono); font-size: .9em; }
:where(.zhin-sandbox) .im-markdown-heading { font-weight: 600; line-height: 1.4; color: hsl(var(--foreground)); }
:where(.zhin-sandbox) .im-markdown-heading-1 { font-size: 20px; }
:where(.zhin-sandbox) .im-markdown-heading-2 { font-size: 18px; }
:where(.zhin-sandbox) .im-markdown-heading-3, :where(.zhin-sandbox) .im-markdown-heading-4 { font-size: 16px; }
:where(.zhin-sandbox) .im-markdown-paragraph { margin: 0; white-space: pre-wrap; }
:where(.zhin-sandbox) .im-markdown-quote { margin: 0; padding: 8px 12px; border-left: 3px solid hsl(var(--border)); border-radius: 0 6px 6px 0; background: hsl(var(--muted)); color: hsl(var(--foreground)); }
:where(.zhin-sandbox) .im-markdown-quote p { margin: 0; }
:where(.zhin-sandbox) .im-markdown-list { margin: 0; padding-left: 20px; }
:where(.zhin-sandbox) .im-markdown-list li + li { margin-top: 4px; }
:where(.zhin-sandbox) .rich-text-editor { font-family: inherit; line-height: 1.6; }
:where(.zhin-sandbox) .rich-text-editor:focus { border-color: hsl(var(--ring)) !important; box-shadow: 0 0 0 1px hsl(var(--ring)); }
:where(.zhin-sandbox) .rich-text-editor:empty::before { content: attr(data-placeholder); color: hsl(var(--muted-foreground)); pointer-events: none; }
:where(.zhin-sandbox) .rich-text-editor .editor-face { display: inline-block; width: 24px; height: 24px; margin: 0 2px; vertical-align: middle; }
:where(.zhin-sandbox) .rich-text-editor .editor-image { display: block; max-width: min(200px,100%); border-radius: 8px; margin: 4px 0; }
:where(.zhin-sandbox) .rich-text-editor .editor-video, :where(.zhin-sandbox) .rich-text-editor .editor-audio, :where(.zhin-sandbox) .rich-text-editor .editor-at { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; margin: 2px; border: 1px solid hsl(var(--border)); border-radius: 5px; background: hsl(var(--muted)); color: hsl(var(--foreground)); font-size: 12px; user-select: none; }
:where(.zhin-sandbox) .rich-text-editor .editor-at-symbol { font-weight: 600; }
`;
