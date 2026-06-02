/**
 * Default sub-agent templates — common presets available to all agents.
 */

import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { SubAgentDef } from '../orchestrator/types.js';

const DEFAULT_SUBAGENTS: SubAgentDef[] = [
  {
    name: 'summarizer',
    description: '文本/对话摘要专家，擅长生成精练的中文摘要',
    systemPrompt: '你是一个专业的摘要助手。请以简洁、准确的中文输出摘要，保留关键信息和重要决定。',
    maxIterations: 3,
  },
  {
    name: 'translator',
    description: '多语言翻译助手，支持中英日韩等语言互译',
    systemPrompt: '你是一个精确的翻译助手。请根据用户需求在不同语言间翻译，保持语义准确和地道表达。',
    maxIterations: 3,
  },
];

export function registerDefaultSubAgents(orchestrator: AgentOrchestrator): void {
  for (const def of DEFAULT_SUBAGENTS) {
    orchestrator.addSubAgent(def, undefined, 'builtin');
  }
}
