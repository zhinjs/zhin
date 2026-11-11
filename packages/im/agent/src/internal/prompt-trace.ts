import type { AgentMessage, AgentTool } from '@zhin.js/ai';
import { formatCompact, truncatePreview, getLogger } from '@zhin.js/logger';
import { estimatePromptTokens } from '../prompt/estimate-tokens.js';
import type { PromptSectionDebugInfo } from '../prompt/system-prompt.js';

const logger = getLogger('ZhinAgent');

export type { HostPromptTraceConfig as PromptTraceConfig } from '../internal/host-types.js';
import type { HostPromptTraceConfig as PromptTraceConfig } from '../internal/host-types.js';

/** Same CJK-aware estimator as the context budget report, so both traces agree. */
function agentMessageTokens(msg: AgentMessage): number {
  if (!Array.isArray(msg.content)) return 0;
  let n = 0;
  for (const part of msg.content) {
    n += estimatePromptTokens(part.type === 'text' ? part.text : JSON.stringify(part));
  }
  return n;
}

function toolsSchemaTokens(tools: AgentTool[]): number {
  return tools.reduce((sum, t) => sum + estimatePromptTokens(JSON.stringify({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  })), 0);
}

function formatSections(sections?: PromptSectionDebugInfo[]): string | undefined {
  if (!sections?.length) return undefined;
  return sections.map(s => `${s.id}:${s.approxChars}`).join(',');
}

export interface LogPromptCompositionInput {
  config: PromptTraceConfig;
  sessionId: string;
  label: string;
  systemPrompt: string;
  sections?: PromptSectionDebugInfo[];
  historyMessages: AgentMessage[];
  tools: AgentTool[];
  userPreview?: string;
}

/** 记录发往 LLM 的提示词规模（分段、历史、工具 schema），不默认 dump 全文。 */
export function logPromptComposition(input: LogPromptCompositionInput): void {
  if (!input.config.promptTraceEnabled) return;

  const systemTokens = estimatePromptTokens(input.systemPrompt);
  const historyTokens = input.historyMessages.reduce((sum, m) => sum + agentMessageTokens(m), 0);
  const userChars = input.userPreview?.length ?? 0;
  const totalEst = systemTokens + historyTokens + toolsSchemaTokens(input.tools)
    + estimatePromptTokens(input.userPreview ?? '');

  const flat: Record<string, string | number | boolean> = {
    phase: 'prompt.compose',
    label: input.label,
    system: systemTokens,
    history: `${input.historyMessages.length}msg/${historyTokens}tok`,
    tools: input.tools.length,
    total: totalEst,
  };

  const sections = formatSections(input.sections);
  if (sections) flat.sections = sections;
  if (userChars > 0) {
    flat.userPreview = truncatePreview(input.userPreview!, 80);
  }

  if (input.config.promptTraceVerbose) {
    flat.systemHead = truncatePreview(input.systemPrompt, 120);
  }

  logger.info(formatCompact(flat));
}
