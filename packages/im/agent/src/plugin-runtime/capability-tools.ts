/**
 * ToolCapability → turn tool 转换（Plugin Runtime runner 注入点）。
 * 打上 snapshot generation 戳，ToolRuntime 在执行前校验戳与当前 turn 是否一致。
 */
import type { Tool } from '@zhin.js/core';
import { toolInputSchemaToParameters } from '@zhin.js/core/tool-zod';
import { stampToolGeneration } from '../tool/tool-system.js';
import type { AgentCapabilities, ToolCapability } from './capability-ingress.js';
import type { ToolInvocationContext } from '@zhin.js/tool';
import type { TurnIngress, TurnRequest } from '../turn/turn-ingress.js';

/** Core transport tool shape plus the generation stamp ToolRuntime validates. */
export type GenerationStampedTool = Tool & { generation?: number };

export function capabilityToTool(
  tool: ToolCapability,
  invocation: ToolInvocationContext,
): GenerationStampedTool {
  const parameters = toolInputSchemaToParameters(tool.inputSchema);
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: (parameters.properties ?? {}) as Tool['parameters']['properties'],
      required: parameters.required,
    },
    source: String(tool.owner),
    platforms: tool.platforms ? [...tool.platforms] : undefined,
    scopes: tool.scopes ? [...tool.scopes] : undefined,
    permissions: tool.permissions ? [...tool.permissions] : undefined,
    hidden: tool.hidden,
    approval: tool.approval,
    async execute(args) {
      return await tool.execute(args, invocation) as Awaited<ReturnType<Tool['execute']>>;
    },
  };
}

/** Owner-visible capabilities → generation-stamped tools for the turn runner. */
export function toolsFromCapabilities(
  capabilities: AgentCapabilities,
  turn: TurnIngress | TurnRequest,
): GenerationStampedTool[] {
  return stampToolGeneration(
    capabilities.tools.map((tool) => capabilityToTool(tool, toolInvocationFromTurn(turn))),
    capabilities.generation,
  );
}

export function toolInvocationFromTurn(turn: TurnIngress | TurnRequest): ToolInvocationContext {
  return Object.freeze({
    signal: turn.signal,
    traceId: turn.identity.traceId,
    turnId: turn.identity.turnId,
    sessionKey: turn.session.key,
    principal: Object.freeze({
      subjectId: turn.principal.subjectId,
      roles: Object.freeze([...turn.principal.roles]),
    }),
  });
}
