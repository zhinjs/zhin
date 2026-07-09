/**
 * 入站 turn 外部工具收集（IM 策略层；阶段 4）。
 */
import type { Plugin, Tool, AgentTurnMessage } from '@zhin.js/core';
import { canAccessTool } from '../orchestrator/tool-selection.js';
import { createOrchestrationTools } from '../builtin/orchestration-tools.js';
import type { AIService } from '../service.js';
import type { CollaborationScene } from './types.js';

export function collectInboundTurnTools(input: {
  root: Plugin;
  ai: AIService;
  commMessage: AgentTurnMessage;
  cell?: CollaborationScene;
}): Tool[] {
  const { root, ai, commMessage, cell } = input;
  const toolService = root.inject('tool');
  let externalTools: Tool[] = [...ai.getResidentToolsAsTools()];
  if (toolService) {
    externalTools.push(...toolService.getAll());
    externalTools = toolService.filterByContext(externalTools, commMessage);
  } else {
    externalTools = externalTools.filter((t) => canAccessTool(t, commMessage));
  }
  if (cell) {
    externalTools.push(...createOrchestrationTools(commMessage));
  }
  return externalTools;
}
