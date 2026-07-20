import type { AgentMessage, AgentTool } from '@zhin.js/ai';
import { formatCompact, truncatePreview, getLogger } from '@zhin.js/logger';
import type { PromptSectionDebugInfo } from '../prompt/system-prompt.js';

const logger = getLogger('ZhinAgent');

export type { HostPromptTraceConfig as PromptTraceConfig } from '../internal/host-types.js';
import type { HostPromptTraceConfig as PromptTraceConfig } from '../internal/host-types.js';

function estTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

function agentMessageChars(msg: AgentMessage): number {
  if (!Array.isArray(msg.content)) return 0;
  let n = 0;
  for (const part of msg.content) {
    if (part.type === 'text') n += part.text.length;
    else n += JSON.stringify(part).length;
  }
  return n;
}

function toolsSchemaChars(tools: AgentTool[]): number {
  return tools.reduce((sum, t) => {
    const blob = JSON.stringify({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    });
    return sum + blob.length;
  }, 0);
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

  const systemChars = input.systemPrompt.length;
  const historyChars = input.historyMessages.reduce((sum, m) => sum + agentMessageChars(m), 0);
  const schemaChars = toolsSchemaChars(input.tools);
  const userChars = input.userPreview?.length ?? 0;
  const totalEst = estTokensFromChars(systemChars + historyChars + schemaChars + userChars);

  const flat: Record<string, string | number | boolean> = {
    phase: 'prompt.compose',
    session: input.sessionId,
    label: input.label,
    systemChars,
    systemEstTokens: estTokensFromChars(systemChars),
    historyMsgs: input.historyMessages.length,
    historyChars,
    historyEstTokens: estTokensFromChars(historyChars),
    toolCount: input.tools.length,
    toolsSchemaChars: schemaChars,
    toolsSchemaEstTokens: estTokensFromChars(schemaChars),
    totalEstTokens: totalEst,
  };

  const sections = formatSections(input.sections);
  if (sections) flat.sections = sections;
  if (input.tools.length > 0) {
    flat.toolNames = input.tools.map(t => t.name).join(',');
  }
  if (userChars > 0) {
    flat.userChars = userChars;
    flat.userPreview = truncatePreview(input.userPreview!, 80);
  }

  if (input.config.promptTraceVerbose) {
    flat.systemHead = truncatePreview(input.systemPrompt, 120);
    flat.systemTail = truncatePreview(
      input.systemPrompt.slice(Math.max(0, input.systemPrompt.length - 120)),
      120,
    );
  }

  logger.info(formatCompact(flat));
}
