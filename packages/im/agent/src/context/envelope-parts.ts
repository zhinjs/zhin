/** Turn envelope 片段 — builder/injector pipeline 写入，buildTextTurnContext 读取。 */
export interface TurnEnvelopeParts {
  profileSummary?: string;
  /** 会话画像：群/频道上下文（`[Session]`）。 */
  sessionSummary?: string;
  toneHint?: string;
  deferredStats?: string;
  activeSkillsContext?: string;
  quoteSystemHint?: string;
  modelLine?: string;
  sdk?: string;
  agentsContext?: string;
}
