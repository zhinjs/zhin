import { storage } from '@zhin.js/core';
import type { Plugin } from '@zhin.js/core';

export type AIEventName =
  | 'ai.processing.start'
  | 'ai.processing.finish'
  | 'ai.processing.error'
  | 'ai.agent.start'
  | 'ai.agent.finish'
  | 'ai.thinking'
  | 'ai.tool.call'
  | 'ai.tool.result'
  | 'ai.response'
  | 'ai.typing.start'
  | 'ai.typing.stop'
  | 'ai.subagent.spawn'
  | 'ai.subagent.start'
  | 'ai.subagent.finish'
  | 'ai.deferred.start'
  | 'ai.deferred.finish'
  | 'ai.mcp.connect.start'
  | 'ai.mcp.connect.finish'
  | 'ai.mcp.connect.error'
  | 'ai.session.new'
  | 'ai.session.compact'
  | 'ai.hook';

export type AIEventPayload = Plugin.AIEventPayload;

export interface AIEventFilter {
  sessionId?: string;
  platform?: string;
  endpointId?: string;
  sceneId?: string;
  source?: Plugin.AIEventPayload['source'];
}

export interface AIEventHandlers {
  onAny?: (event: AIEventName, payload: AIEventPayload) => void;
  onProcessingStart?: (payload: AIEventPayload) => void;
  onProcessingFinish?: (payload: AIEventPayload) => void;
  onProcessingError?: (payload: AIEventPayload) => void;
  onAgentStart?: (payload: AIEventPayload) => void;
  onAgentFinish?: (payload: AIEventPayload) => void;
  onThinking?: (payload: AIEventPayload) => void;
  onToolCall?: (payload: AIEventPayload) => void;
  onToolResult?: (payload: AIEventPayload) => void;
  onResponse?: (payload: AIEventPayload) => void;
  onTypingStart?: (payload: AIEventPayload) => void;
  onTypingStop?: (payload: AIEventPayload) => void;
  onSubagentSpawn?: (payload: AIEventPayload) => void;
  onSubagentStart?: (payload: AIEventPayload) => void;
  onSubagentFinish?: (payload: AIEventPayload) => void;
  onDeferredStart?: (payload: AIEventPayload) => void;
  onDeferredFinish?: (payload: AIEventPayload) => void;
  onMcpConnectStart?: (payload: AIEventPayload) => void;
  onMcpConnectFinish?: (payload: AIEventPayload) => void;
  onMcpConnectError?: (payload: AIEventPayload) => void;
  onSessionNew?: (payload: AIEventPayload) => void;
  onSessionCompact?: (payload: AIEventPayload) => void;
  onHook?: (payload: AIEventPayload) => void;
}

const EVENT_HANDLER_MAP: Record<AIEventName, keyof AIEventHandlers | undefined> = {
  'ai.processing.start': 'onProcessingStart',
  'ai.processing.finish': 'onProcessingFinish',
  'ai.processing.error': 'onProcessingError',
  'ai.agent.start': 'onAgentStart',
  'ai.agent.finish': 'onAgentFinish',
  'ai.thinking': 'onThinking',
  'ai.tool.call': 'onToolCall',
  'ai.tool.result': 'onToolResult',
  'ai.response': 'onResponse',
  'ai.typing.start': 'onTypingStart',
  'ai.typing.stop': 'onTypingStop',
  'ai.subagent.spawn': 'onSubagentSpawn',
  'ai.subagent.start': 'onSubagentStart',
  'ai.subagent.finish': 'onSubagentFinish',
  'ai.deferred.start': 'onDeferredStart',
  'ai.deferred.finish': 'onDeferredFinish',
  'ai.mcp.connect.start': 'onMcpConnectStart',
  'ai.mcp.connect.finish': 'onMcpConnectFinish',
  'ai.mcp.connect.error': 'onMcpConnectError',
  'ai.session.new': 'onSessionNew',
  'ai.session.compact': 'onSessionCompact',
  'ai.hook': 'onHook',
};

export const AI_EVENT_NAMES = Object.keys(EVENT_HANDLER_MAP) as AIEventName[];

function matchesFilter(payload: AIEventPayload, filter?: AIEventFilter): boolean {
  if (!filter) return true;
  if (filter.sessionId && payload.sessionId !== filter.sessionId) return false;
  if (filter.platform && payload.platform !== filter.platform) return false;
  if (filter.endpointId && payload.endpointId !== filter.endpointId) return false;
  if (filter.sceneId && payload.sceneId !== filter.sceneId) return false;
  if (filter.source && payload.source !== filter.source) return false;
  return true;
}

export function subscribeAIEvents(
  plugin: Plugin,
  handlers: AIEventHandlers,
  filter?: AIEventFilter,
): () => void {
  const disposers = AI_EVENT_NAMES.map((eventName) => {
    const listener = (payload: AIEventPayload) => {
      if (!matchesFilter(payload, filter)) return;
      // broadcast 不经过 usePlugin 加载栈；在订阅方入口恢复 ALS，避免监听里 getPlugin() 失效
      void storage.run(plugin, async () => {
        handlers.onAny?.(eventName, payload);
        const handlerName = EVENT_HANDLER_MAP[eventName];
        const handler = handlerName ? handlers[handlerName] : undefined;
        if (typeof handler === 'function') {
          await (handler as (payload: AIEventPayload) => void | Promise<void>)(payload);
        }
      });
    };
    plugin.on(eventName, listener);
    return () => plugin.off(eventName, listener);
  });
  return () => {
    for (const dispose of disposers) dispose();
  };
}