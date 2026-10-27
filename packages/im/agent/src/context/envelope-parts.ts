/** Turn envelope 片段 — builder/injector pipeline 写入，buildTextTurnContext 读取。 */
export interface TurnEnvelopeParts {
  profileSummary?: string;
  /** 会话画像：群/频道上下文（`[Session]`）。 */
  sessionSummary?: string;
  /** 状态感知：最近社交事件（`[Scene events]`，ephemeral）。 */
  sceneEvents?: string;
  toneHint?: string;
  deferredStats?: string;
  activeSkillsContext?: string;
  quoteSystemHint?: string;
  modelLine?: string;
  sdk?: string;
  agentsContext?: string;
}
