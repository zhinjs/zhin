/**
 * Plugin hooks bridged to agentLoop (ADR 0010 D5).
 */
import type { AgentMessage, BeforeToolCallResult, ParsedToolCall } from '@zhin.js/ai';

export interface PluginBeforeToolCallContext {
  toolCall: ParsedToolCall;
  sessionId?: string;
}

export interface PluginAfterToolCallContext {
  toolCall: ParsedToolCall;
  result: AgentMessage;
  sessionId?: string;
}

export interface PluginTransformContextContext {
  sessionId?: string;
  signal?: AbortSignal;
}

export type PluginBeforeToolCallHandler = (
  ctx: PluginBeforeToolCallContext,
) => Promise<BeforeToolCallResult | void> | BeforeToolCallResult | void;

export type PluginAfterToolCallHandler = (
  ctx: PluginAfterToolCallContext,
) => Promise<void> | void;

export type PluginTransformContextHandler = (
  messages: AgentMessage[],
  ctx: PluginTransformContextContext,
) => Promise<AgentMessage[]> | AgentMessage[];

export class PluginAILoopHookRegistry {
  private readonly beforeHandlers: PluginBeforeToolCallHandler[] = [];
  private readonly afterHandlers: PluginAfterToolCallHandler[] = [];
  private readonly transformHandlers: PluginTransformContextHandler[] = [];

  onBeforeToolCall(handler: PluginBeforeToolCallHandler): () => void {
    this.beforeHandlers.push(handler);
    return () => {
      const i = this.beforeHandlers.indexOf(handler);
      if (i >= 0) this.beforeHandlers.splice(i, 1);
    };
  }

  onAfterToolCall(handler: PluginAfterToolCallHandler): () => void {
    this.afterHandlers.push(handler);
    return () => {
      const i = this.afterHandlers.indexOf(handler);
      if (i >= 0) this.afterHandlers.splice(i, 1);
    };
  }

  onTransformContext(handler: PluginTransformContextHandler): () => void {
    this.transformHandlers.push(handler);
    return () => {
      const i = this.transformHandlers.indexOf(handler);
      if (i >= 0) this.transformHandlers.splice(i, 1);
    };
  }

  async runBeforeToolCall(
    ctx: PluginBeforeToolCallContext,
  ): Promise<BeforeToolCallResult | void> {
    let merged: BeforeToolCallResult | undefined;
    for (const handler of this.beforeHandlers) {
      try {
        const result = await handler(ctx);
        if (result) {
          merged = { ...(merged ?? {}), ...result };
          if (result.allowed === false) return merged;
        }
      } catch {
        // isolate plugin errors
      }
    }
    return merged;
  }

  async runAfterToolCall(ctx: PluginAfterToolCallContext): Promise<void> {
    for (const handler of this.afterHandlers) {
      try {
        await handler(ctx);
      } catch {
        // isolate
      }
    }
  }

  async runTransformContext(
    messages: AgentMessage[],
    ctx: PluginTransformContextContext,
  ): Promise<AgentMessage[]> {
    let out = messages;
    for (const handler of this.transformHandlers) {
      try {
        out = await handler(out, ctx);
      } catch {
        // isolate
      }
    }
    return out;
  }
}
