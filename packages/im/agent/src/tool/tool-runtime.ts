/**
 * ToolRuntime — 统一工具执行网关。
 *
 * 所有工具类型（builtin、Host、MCP、Skill、Agent）都必须通过 ToolRuntime 执行：
 * 1. Generation 验证 — 工具的 generation 戳是否仍有效
 * 2. 安全策略 — runToolPolicies() 统一执行（builtin 不再自行调用）
 * 3. 取消感知 — 对齐 turn AbortSignal
 * 4. Journal 事件 — 发射 tool_call / tool_result
 * 5. 审计 — policyAudit 链路记录
 *
 * ToolRuntime 按 turn 创建（createToolRuntime），绑定 turn 级上下文。
 */
import type { AgentTool } from '@zhin.js/ai';
import type { Message, Plugin } from '@zhin.js/core';
import type { ZhinAgentConfig } from '../config/index.js';
import {
  runToolPolicies,
  toolPolicyResultToMessage,
  type ToolPolicyInput,
  type ToolPolicyResult,
  type ToolPolicyLayerRecord,
} from '../security/policy-facade.js';
import type { ToolCallEvent, ToolResultEvent } from '../event/turn-event.js';

export interface ToolRuntimeJournalPort {
  append(event: ToolCallEvent | ToolResultEvent): void | Promise<void>;
}

// ── 类型定义 ───────────────────────────────────────────────────────

export interface ToolRuntimeTurnContext {
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly sessionId: string;
  readonly commMessage?: Message;
  readonly journal?: ToolRuntimeJournalPort;
  readonly config?: Required<ZhinAgentConfig>;
  readonly hostPlugin?: Plugin;
  readonly isGenerationValid?: (gen: number) => boolean;
}

export interface ToolCallContext {
  readonly toolCallId: string;
}

export interface ToolExecutionOutcome {
  readonly output: unknown;
  readonly durationMs: number;
  readonly denied?: string;
  readonly policyAudit: readonly ToolPolicyLayerRecord[];
}

/**
 * 工具策略输入提取器 — 从工具名和参数派生 ToolPolicyInput。
 * builtin 工具注册自己的提取器；非 builtin 使用默认提取器（仅 toolName）。
 */
export type ToolPolicyInputExtractor = (
  toolName: string,
  args: Record<string, unknown>,
  commMessage?: Message,
  hostPlugin?: Plugin,
) => ToolPolicyInput;

// ── 默认策略提取器注册表 ─────────────────────────────────────────

const extractorRegistry = new Map<string, ToolPolicyInputExtractor>();

export function registerPolicyExtractor(toolName: string, extractor: ToolPolicyInputExtractor): void {
  extractorRegistry.set(toolName, extractor);
}

function defaultExtractor(toolName: string, _args: Record<string, unknown>, commMessage?: Message): ToolPolicyInput {
  return { toolName, commMessage };
}

function resolveExtractor(toolName: string): ToolPolicyInputExtractor {
  return extractorRegistry.get(toolName) ?? defaultExtractor;
}

// ── ToolRuntime ─────────────────────────────────────────────────────

export interface ToolRuntime {
  execute(tool: AgentTool, args: Record<string, unknown>, call: ToolCallContext): Promise<ToolExecutionOutcome>;
  checkPolicy(input: ToolPolicyInput): ToolPolicyResult;
  readonly generation: number;
}

export function createToolRuntime(ctx: ToolRuntimeTurnContext): ToolRuntime {
  return {
    generation: ctx.generation,

    checkPolicy(input: ToolPolicyInput): ToolPolicyResult {
      return runToolPolicies(input);
    },

    async execute(
      tool: AgentTool,
      args: Record<string, unknown>,
      call: ToolCallContext,
    ): Promise<ToolExecutionOutcome> {
      const t0 = performance.now();
      const toolName = tool.name;

      // 1. Generation 验证 — context-level and tool-level
      if (ctx.isGenerationValid && !ctx.isGenerationValid(ctx.generation)) {
        return {
          output: `Error: tool「${toolName}」rejected — generation ${ctx.generation} is no longer valid`,
          durationMs: performance.now() - t0,
          denied: 'generation_invalid',
          policyAudit: [],
        };
      }
      if (tool.generation !== undefined && tool.generation !== ctx.generation) {
        return {
          output: `Error: tool「${toolName}」rejected — tool generation ${tool.generation} does not match turn generation ${ctx.generation}`,
          durationMs: performance.now() - t0,
          denied: 'generation_mismatch',
          policyAudit: [],
        };
      }

      // 2. 取消检查
      if (ctx.signal.aborted) {
        throw ctx.signal.reason instanceof Error
          ? ctx.signal.reason
          : new Error('Tool execution cancelled');
      }

      // 3. 安全策略
      const extractor = resolveExtractor(toolName);
      const policyInput = extractor(toolName, args, ctx.commMessage, ctx.hostPlugin);
      if (ctx.config) policyInput.config = ctx.config;
      const policyResult = runToolPolicies(policyInput);
      const policyAudit = policyResult.decisions;
      const denied = toolPolicyResultToMessage(policyResult, toolName);
      if (denied) {
        await emitToolEvents(ctx, toolName, args, call.toolCallId, denied, performance.now() - t0);
        return { output: denied, durationMs: performance.now() - t0, denied, policyAudit };
      }

      // 4. Journal: tool_call
      await emitToolCall(ctx, toolName, args, call.toolCallId);

      // 5. 执行（取消感知）
      let output: unknown;
      try {
        output = await Promise.resolve().then(() =>
          tool.execute(args, ctx.commMessage, {
            signal: ctx.signal,
            sessionId: ctx.sessionId,
            toolCallId: call.toolCallId,
            toolName,
          }),
        );
      } catch (err) {
        if (ctx.signal.aborted) {
          throw ctx.signal.reason instanceof Error
            ? ctx.signal.reason
            : new Error('Tool execution cancelled');
        }
        throw err;
      }

      // 6. 取消后检查
      if (ctx.signal.aborted) {
        throw ctx.signal.reason instanceof Error
          ? ctx.signal.reason
          : new Error('Tool execution cancelled');
      }

      const durationMs = performance.now() - t0;

      // 7. Journal: tool_result
      await emitToolResult(ctx, toolName, output, call.toolCallId, durationMs);

      return { output, durationMs, policyAudit };
    },
  };
}

// ── Journal 事件辅助 ─────────────────────────────────────────────────

async function emitToolCall(
  ctx: ToolRuntimeTurnContext,
  toolName: string,
  args: Record<string, unknown>,
  toolUseId: string,
): Promise<void> {
  await ctx.journal?.append({ type: 'tool_call', toolName, args, toolUseId });
}

async function emitToolResult(
  ctx: ToolRuntimeTurnContext,
  toolName: string,
  output: unknown,
  toolUseId: string,
  durationMs: number,
): Promise<void> {
  await ctx.journal?.append({ type: 'tool_result', toolName, output, toolUseId, durationMs });
}

async function emitToolEvents(
  ctx: ToolRuntimeTurnContext,
  toolName: string,
  args: Record<string, unknown>,
  toolUseId: string,
  output: unknown,
  durationMs: number,
): Promise<void> {
  await emitToolCall(ctx, toolName, args, toolUseId);
  await emitToolResult(ctx, toolName, output, toolUseId, durationMs);
}
