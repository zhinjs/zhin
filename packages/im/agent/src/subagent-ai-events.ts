import { resolveIMSessionIdFromToolContext } from '@zhin.js/ai';
import type { AgentLoopStandaloneCallbacks } from './zhin-agent/agent-loop-standalone.js';
import type { ToolContext } from '@zhin.js/core';
import type { McpRegistry } from './orchestrator/mcp-registry.js';
import { ensureMcpConnectionsForBinding } from './orchestrator/mcp-lifecycle.js';
import type { SubagentOrigin } from './subagent.js';
import type { ZhinAgentEventEmitter } from './zhin-agent/event-emitter.js';

export interface SubagentAiEventContext {
  taskId: string;
  label: string;
  presetName?: string;
  origin: SubagentOrigin;
  /** 为 true 时不在 processing.finish 里发 typing.stop（入站 route + 主 agent 摘要续接） */
  keepTypingUntilUpstreamFinish?: boolean;
}

export class SubagentAiEventReporter {
  readonly sessionId: string;
  readonly toolContext: ToolContext;

  constructor(
    private readonly emitter: ZhinAgentEventEmitter,
    private readonly ctx: SubagentAiEventContext,
  ) {
    const scope = ctx.origin.sceneType === 'group' || ctx.origin.sceneType === 'channel'
      ? ctx.origin.sceneType
      : 'private';
    this.toolContext = {
      platform: ctx.origin.platform,
      botId: ctx.origin.botId,
      sceneId: ctx.origin.sceneId,
      senderId: ctx.origin.senderId,
      messageId: ctx.origin.messageId,
      scope,
      fileRole: ctx.origin.fileRole,
    };
    this.sessionId = resolveIMSessionIdFromToolContext({
      platform: ctx.origin.platform,
      botId: ctx.origin.botId,
      scope,
      sceneId: ctx.origin.sceneId,
      senderId: ctx.origin.senderId,
    });
  }

  private payload(extra: Partial<import('@zhin.js/core').Plugin.AIEventPayload> = {}) {
    return this.emitter.createPayload(this.sessionId, this.toolContext, 'text', {
      source: 'subagent',
      path: 'agent',
      taskId: this.ctx.taskId,
      label: this.ctx.label,
      agentId: this.ctx.presetName ?? this.ctx.label,
      ...extra,
    });
  }

  async processingStart(content: string): Promise<void> {
    await this.emitter.dispatch('ai.processing.start', this.payload({
      content,
      keepTyping: this.ctx.keepTypingUntilUpstreamFinish,
    }));
  }

  async processingFinish(reply: string, extra?: Partial<import('@zhin.js/core').Plugin.AIEventPayload>): Promise<void> {
    await this.emitter.dispatch('ai.processing.finish', this.payload({
      reply,
      keepTyping: this.ctx.keepTypingUntilUpstreamFinish,
      ...extra,
    }));
    if (!this.ctx.keepTypingUntilUpstreamFinish) {
      this.emitter.emit('ai.typing.stop', this.payload({ reason: 'subagent_done' }));
    }
  }

  async processingError(error: string): Promise<void> {
    await this.emitter.dispatch('ai.processing.error', this.payload({ error }));
    if (!this.ctx.keepTypingUntilUpstreamFinish) {
      this.emitter.emit('ai.typing.stop', this.payload({ reason: 'subagent_error' }));
    }
  }

  async ensureMcpForBinding(mcps: McpRegistry, serverNames: string[]): Promise<void> {
    await ensureMcpConnectionsForBinding(mcps, serverNames, (event) => {
      const payload = this.payload({
        serverName: event.serverName,
        loadedToolNames: event.toolNames,
        error: event.error,
        reason: event.connected === false ? 'disconnected' : undefined,
      });
      if (event.phase === 'start') {
        this.emitter.emit('ai.mcp.connect.start', payload);
      } else if (event.phase === 'finish') {
        this.emitter.emit('ai.mcp.connect.finish', payload);
      } else {
        this.emitter.emit('ai.mcp.connect.error', payload);
      }
    });
  }

  createAgentLoopCallbacks(model: string): AgentLoopStandaloneCallbacks {
    return {
      onToolCall: (toolName, args) => {
        this.emitter.emit('ai.tool.call', this.payload({
          toolName,
          args,
          model,
        }));
      },
      onToolResult: (toolName, result) => {
        this.emitter.emit('ai.tool.result', this.payload({
          toolName,
          result,
          model,
        }));
      },
    };
  }

  async agentStart(model: string): Promise<void> {
    await this.emitter.dispatch('ai.agent.start', this.payload({ model }));
  }

  async agentFinish(model: string | undefined, iterations: number): Promise<void> {
    await this.emitter.dispatch('ai.agent.finish', this.payload({ model, iterations }));
  }

  async response(reply: string, model: string | undefined, iterations: number): Promise<void> {
    await this.emitter.dispatch('ai.response', this.payload({ reply, model, iterations }));
  }
}
