/**
 * MessageDispatcher — 消息调度器
 *
 * 经典 Plugin 入站的 AI 调度与出站润色上下文。
 *
 *   ┌────────────────────────────────────────┐
 *   │  Stage 1: Guardrail（护栏）             │
 *   │  鉴权、限流、安全过滤、日志记录          │
 *   │  始终执行，不可被 AI 跳过                │
 *   └──────────────┬─────────────────────────┘
 *                  ▼
 *   AI trigger → aiHandler → replyWithPolish → Adapter.sendMessage
 *
 * 注意：Context key 为 'dispatcher'，避免与 HTTP 模块的 'router' 冲突。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Message } from '../message.js';
import { isActionMessage } from './interactive-segments/action.js';
import { Plugin, type Context } from '../plugin.js';
import type {
  MessageMiddleware,
  RegisteredAdapter,
  MaybePromise,
  SendContent,
  OutboundReplySource,
  OutboundPolishContext,
  OutboundPolishMiddleware,
  OutboundReplyStore,
  BeforeSendHandler,
} from '../types.js';

/** Dispatcher 管理的「会话回复」异步上下文，供 `before.sendMessage` 内读取（与 Adapter.renderSendMessage 同链） */
const outboundReplyAls = new AsyncLocalStorage<OutboundReplyStore>();

export function getOutboundReplyStore(): OutboundReplyStore | undefined {
  return outboundReplyAls.getStore();
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * AI 处理函数签名
 * 由 AI 模块通过 dispatcher.setAIHandler() 注册
 */
export type AIHandler = (
  message: Message<any>,
  content: string,
) => MaybePromise<void>;

/**
 * AI 触发判定函数
 */
export type AITriggerMatcher = (message: Message<any>) => { triggered: boolean; content: string };

/**
 * 群/频道未触发 AI 时的旁听写入（由 Agent 注册；仅写 session 上下文，不回复）
 */
export type GroupPassiveContextHandler = (message: Message<any>) => MaybePromise<void>;

export type GuardrailMiddleware = MessageMiddleware<RegisteredAdapter>;

/** Dispatcher outbound reply source. */
export type ReplySource = OutboundReplySource;

/** replyWithPolish 可选参数 */
export interface ReplyWithPolishOptions {
  /** 引用入站消息（true 用 message.$id；string 为指定消息 id） */
  quote?: boolean | string;
}

// ============================================================================
// MessageDispatcher 服务
// ============================================================================

export interface MessageDispatcherService {
  dispatch(message: Message<any>): Promise<void>;

  addGuardrail(guardrail: GuardrailMiddleware): () => void;

  setAITriggerMatcher(matcher: AITriggerMatcher): void;

  setAIHandler(handler: AIHandler): void;

  /** 群/频道消息未走 AI 时写入共享 session（如未 @ 的闲聊） */
  setGroupPassiveContextHandler(handler: GroupPassiveContextHandler | null): void;

  hasAIHandler(): boolean;

  /** 注册出站润色：挂到根插件 `before.sendMessage`；仅在 `replyWithPolish` 触发的发送中生效（见 getOutboundReplyStore） */
  addOutboundPolish(handler: OutboundPolishMiddleware): () => void;

  /**
   * 在 `before.sendMessage` 管道内调用 `message.$reply`（与 Adapter#sendMessage 同一出站链）
   */
  replyWithPolish(
    message: Message<any>,
    source: ReplySource,
    content: SendContent,
    options?: ReplyWithPolishOptions,
  ): Promise<unknown>;

  /** Proactive 出站：在 ALS 内执行 send，触发 outbound polish / before.sendMessage */
  runWithOutboundPolish<T>(
    store: Pick<OutboundReplyStore, 'message' | 'trigger' | 'proactiveSource'> & { source?: OutboundReplySource },
    fn: () => Promise<T>,
  ): Promise<T>;

  /**
   * AI 触发判定结果
   */
  matchAI(message: Message<any>): { triggered: boolean; content: string };
}

// ============================================================================
// 扩展 Plugin 接口
// ============================================================================

export interface DispatcherContextExtensions {
  addGuardrail(guardrail: GuardrailMiddleware): () => void;
  addOutboundPolish(handler: OutboundPolishMiddleware): () => void;
}

declare module '../plugin.js' {
  namespace Plugin {
    interface Extensions extends DispatcherContextExtensions {}
    interface Contexts {
      dispatcher: MessageDispatcherService;
    }
  }
}

// ============================================================================
// 实现
// ============================================================================

export function createMessageDispatcher(): Context<'dispatcher', DispatcherContextExtensions> {
  const guardrails: GuardrailMiddleware[] = [];
  /** mounted 前注册的润色，在 mounted 时挂到 root.before.sendMessage */
  const pendingOutboundPolish: OutboundPolishMiddleware[] = [];
  const flushedOutboundPolish: Map<OutboundPolishMiddleware, BeforeSendHandler> = new Map();
  let aiHandler: AIHandler | null = null;
  let aiTriggerMatcher: AITriggerMatcher | null = null;
  let groupPassiveContextHandler: GroupPassiveContextHandler | null = null;
  let rootPlugin: Plugin | null = null;

  async function runGuardrails(message: Message<any>): Promise<boolean> {
    if (guardrails.length === 0) return true;

    for (const guardrail of guardrails) {
      let nextCalled = false;
      try {
        await guardrail(message, async () => {
          nextCalled = true;
        });
      } catch {
        return false;
      }
      if (!nextCalled) return false;
    }
    return true;
  }

  function matchAIInternal(message: Message<any>): { triggered: boolean; content: string } {
    if (!aiTriggerMatcher) return { triggered: false, content: '' };
    return aiTriggerMatcher(message);
  }

  function wrapPolishAsBeforeSend(handler: OutboundPolishMiddleware): BeforeSendHandler {
    return async (options) => {
      const store = outboundReplyAls.getStore();
      if (!store) return;
      const ctx: OutboundPolishContext = {
        message: store.message,
        content: options.content,
        source: store.source,
      };
      const next = await handler(ctx);
      if (next !== undefined) return { ...options, content: next };
    };
  }

  function flushPendingOutboundPolish(): void {
    if (!rootPlugin) return;
    const root = rootPlugin.root;
    for (const mw of pendingOutboundPolish) {
      const fn = wrapPolishAsBeforeSend(mw);
      root.on('before.sendMessage', fn);
      flushedOutboundPolish.set(mw, fn);
    }
    pendingOutboundPolish.length = 0;
  }

  async function replyWithPolishInternal(
    message: Message<any>,
    source: ReplySource,
    content: SendContent,
    options?: ReplyWithPolishOptions,
  ): Promise<unknown> {
    const quote = options?.quote;
    if (!message.$reply) {
      throw new Error(
        `Cannot reply: endpoint ${message.$endpoint} on adapter ${String(message.$adapter)} has no outbound capability`,
      );
    }
    if (!rootPlugin) {
      return quote ? message.$reply(content, quote) : message.$reply(content);
    }
    return outboundReplyAls.run({
      message,
      source,
      trigger: 'inbound',
    }, () =>
      quote ? message.$reply(content, quote) : message.$reply(content),
    );
  }

  async function runWithOutboundPolish<T>(
    store: Pick<OutboundReplyStore, 'message' | 'trigger' | 'proactiveSource'> & { source?: OutboundReplySource },
    fn: () => Promise<T>,
  ): Promise<T> {
    return outboundReplyAls.run({
      message: store.message,
      source: store.source ?? 'proactive',
      trigger: store.trigger,
      proactiveSource: store.proactiveSource,
    }, fn);
  }

  async function maybeRecordGroupPassiveContext(message: Message<any>): Promise<void> {
    if (!groupPassiveContextHandler || isActionMessage(message)) return;
    const scope = message.$channel?.type;
    if (scope !== 'group' && scope !== 'channel') return;
    try {
      await groupPassiveContextHandler(message);
    } catch {
      // 旁听写入失败不影响主链路
    }
  }

  const service: MessageDispatcherService = {
    async dispatch(message: Message<any>) {
      const passed = await runGuardrails(message);
      if (!passed) return;

      const aiRes = matchAIInternal(message);
      if (!aiRes.triggered) {
        await maybeRecordGroupPassiveContext(message);
        return;
      }
      if (aiHandler) await aiHandler(message, aiRes.content);
    },

    addGuardrail(guardrail: GuardrailMiddleware) {
      guardrails.push(guardrail);
      return () => {
        const index = guardrails.indexOf(guardrail);
        if (index !== -1) guardrails.splice(index, 1);
      };
    },

    setAITriggerMatcher(matcher: AITriggerMatcher) {
      aiTriggerMatcher = matcher;
    },

    setAIHandler(handler: AIHandler) {
      aiHandler = handler;
    },

    setGroupPassiveContextHandler(handler: GroupPassiveContextHandler | null) {
      groupPassiveContextHandler = handler;
    },

    hasAIHandler() {
      return aiHandler !== null;
    },

    addOutboundPolish(handler: OutboundPolishMiddleware) {
      const fn = wrapPolishAsBeforeSend(handler);
      if (rootPlugin) {
        const root = rootPlugin.root;
        root.on('before.sendMessage', fn);
        return () => root.off('before.sendMessage', fn);
      }
      pendingOutboundPolish.push(handler);
      return () => {
        const i = pendingOutboundPolish.indexOf(handler);
        if (i !== -1) pendingOutboundPolish.splice(i, 1);
        const flushed = flushedOutboundPolish.get(handler);
        if (flushed && rootPlugin) {
          rootPlugin.root.off('before.sendMessage', flushed);
          flushedOutboundPolish.delete(handler);
        }
      };
    },

    replyWithPolish(message, source, content, options) {
      return replyWithPolishInternal(message, source, content, options);
    },
    runWithOutboundPolish(store, fn) {
      return runWithOutboundPolish(store, fn);
    },

    matchAI(message) {
      return matchAIInternal(message);
    },
  };

  return {
    name: 'dispatcher',
    description: '消息调度器 — AI 路由与出站润色',
    value: service,
    mounted(plugin: Plugin) {
      rootPlugin = plugin.root;
      flushPendingOutboundPolish();
      return service;
    },
    extensions: {
      addGuardrail(guardrail: GuardrailMiddleware) {
        const dispose = service.addGuardrail(guardrail);
        rootPlugin?.onDispose(dispose);
        return dispose;
      },
      addOutboundPolish(handler: OutboundPolishMiddleware) {
        const dispose = service.addOutboundPolish(handler);
        rootPlugin?.onDispose(dispose);
        return dispose;
      },
    },
  };
}
