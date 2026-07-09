/** Turn envelope 片段 — builder/injector pipeline 写入，buildTextTurnContext 读取。 */
export interface TurnEnvelopeParts {
  profileSummary?: string;
  toneHint?: string;
  deferredStats?: string;
  activeSkillsContext?: string;
  quoteSystemHint?: string;
  collaborationHint?: string;
  modelLine?: string;
  sdk?: string;
  agentsContext?: string;
}
