/**
 * MessageDispatcher — 消息调度器
 *
 * 取代原先的"大杂烩中间件链"，将消息处理分为三个清晰阶段：
 *
 *   ┌────────────────────────────────────────┐
 *   │  Stage 1: Guardrail（护栏）             │
 *   │  鉴权、限流、安全过滤、日志记录          │
 *   │  始终执行，不可被 AI 跳过                │
 *   └──────────────┬─────────────────────────┘
 *                  ▼
 *   ┌────────────────────────────────────────┐
 *   │  Stage 2: Route（路径判定）             │
 *   │  exclusive：命令与 AI 互斥（旧行为）     │
 *   │  dual：命令与 AI 独立判定，可同时命中     │
 *   └──────────────┬─────────────────────────┘
 *                  ▼
 *   ┌────────────────────────────────────────┐
 *   │  Stage 3: Handle（处理）                │
 *   │  Command: commandService.handle()      │
 *   │  AI: aiHandler (由 AI 模块注册)         │
 *   │  出站：replyWithPolish → $reply → Adapter.sendMessage → before.sendMessage │
 *   └────────────────────────────────────────┘
 *
 * 注意：Context key 为 'dispatcher'，避免与 HTTP 模块的 'router' 冲突。
 *
 * 默认路由为 exclusive（命令与 AI 互斥）；需双轨时请显式 dualRoute.mode: 'dual'。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Message } from '../message.js';
import { Plugin, getPlugin } from '../plugin.js';
import type {
  MessageMiddleware,
  RegisteredAdapter,
  MaybePromise,
  SendContent,
  OutboundReplySource,
  OutboundPolishContext,
  OutboundPolishMiddleware,
  BeforeSendHandler,
} from '../types.js';
import type { Context } from '../plugin.js';

/** Dispatcher 管理的「会话回复」异步上下文，供 `before.sendMessage` 内读取（与 Adapter.renderSendMessage 同链） */
const outboundReplyAls = new AsyncLocalStorage<{ message: Message<any>; source: OutboundReplySource }>();

export function getOutboundReplyStore(): { message: Message<any>; source: OutboundReplySource } | undefined {
  return outboundReplyAls.getStore();
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 路由判定结果（互斥模式 legacy）
 */
export type RouteResult =
  | { type: 'command' }
  | { type: 'ai'; content: string }
  | { type: 'skip' };

/**
 * 双轨分流配置
 */
export interface DualRouteConfig {
  /**
   * exclusive：与旧版一致，命中命令则不再走 AI；
   * dual：命令与 AI 独立判定，可同时执行（顺序由 order 决定）
   */
  mode?: 'exclusive' | 'dual';
  /** 同时命中时的执行顺序，默认先指令后 AI */
  order?: 'command-first' | 'ai-first';
  /**
   * 是否允许在双命中时各回复一次；为 false 时仅执行 order 中的第一个分支
   */
  allowDualReply?: boolean;
}

export type ResolvedDualRouteConfig = Required<DualRouteConfig>;

const DUAL_ROUTE_DEFAULTS: ResolvedDualRouteConfig = {
  mode: 'exclusive',
  order: 'command-first',
  allowDualReply: false,
};

function resolveDualRouteConfig(partial?: Partial<DualRouteConfig>): ResolvedDualRouteConfig {
  return {
    mode: partial?.mode ?? DUAL_ROUTE_DEFAULTS.mode,
    order: partial?.order ?? DUAL_ROUTE_DEFAULTS.order,
    allowDualReply: partial?.allowDualReply ?? DUAL_ROUTE_DEFAULTS.allowDualReply,
  };
}

/**
 * AI 处理函数签名
 * 由 AI 模块通过 dispatcher.setAIHandler() 注册
 */
export type AIHandler = (
  message: Message<any>,
  content: string,
) => MaybePromise<void>;

/**
 * 命令前缀判定函数
 */
export type CommandMatcher = (text: string, message: Message<any>) => boolean;

/**
 * AI 触发判定函数
 */
export type AITriggerMatcher = (message: Message<any>) => { triggered: boolean; content: string };

export type GuardrailMiddleware = MessageMiddleware<RegisteredAdapter>;

/** @alias OutboundReplySource：出站回复来源（指令 / AI） */
export type ReplySource = OutboundReplySource;

export interface CreateMessageDispatcherOptions {
  dualRoute?: Partial<DualRouteConfig>;
}

// ============================================================================
// MessageDispatcher 服务
// ============================================================================

export interface MessageDispatcherService {
  dispatch(message: Message<any>): Promise<void>;

  addGuardrail(guardrail: GuardrailMiddleware): () => void;

  setCommandMatcher(matcher: CommandMatcher): void;

  setAITriggerMatcher(matcher: AITriggerMatcher): void;

  setAIHandler(handler: AIHandler): void;

  hasAIHandler(): boolean;

  /** 合并更新双轨配置 */
  setDualRouteConfig(config: Partial<DualRouteConfig>): void;

  getDualRouteConfig(): Readonly<ResolvedDualRouteConfig>;

  /** 注册出站润色：挂到根插件 `before.sendMessage`；仅在 `replyWithPolish` 触发的发送中生效（见 getOutboundReplyStore） */
  addOutboundPolish(handler: OutboundPolishMiddleware): () => void;

  /**
   * 在 `before.sendMessage` 管道内调用 `message.$reply`（与 Adapter#sendMessage 同一出站链）
   */
  replyWithPolish(
    message: Message<any>,
    source: ReplySource,
    content: SendContent,
  ): Promise<unknown>;

  /**
   * 是否匹配为指令路径（与 dispatch 内判定一致）
   */
  matchCommand(message: Message<any>): boolean;

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

export function createMessageDispatcher(
  options?: CreateMessageDispatcherOptions,
): Context<'dispatcher', DispatcherContextExtensions> {
  const guardrails: GuardrailMiddleware[] = [];
  /** mounted 前注册的润色，在 mounted 时挂到 root.before.sendMessage */
  const pendingOutboundPolish: OutboundPolishMiddleware[] = [];
  let aiHandler: AIHandler | null = null;
  let aiTriggerMatcher: AITriggerMatcher | null = null;
  let commandMatcher: CommandMatcher | null = null;
  let rootPlugin: Plugin | null = null;
  let dualRoute = resolveDualRouteConfig(options?.dualRoute);

  let commandPrefixIndex: Map<string, boolean> | null = null;
  let lastCommandCount = -1;

  function rebuildCommandIndex(): Map<string, boolean> {
    const index = new Map<string, boolean>();
    if (rootPlugin) {
      const commandService = rootPlugin.inject('command');
      if (commandService?.items) {
        for (const cmd of commandService.items) {
          const prefix = cmd.pattern?.split(/\s/)[0];
          if (prefix) index.set(prefix, true);
        }
      }
    }
    return index;
  }

  function getCommandIndex(): Map<string, boolean> {
    const commandService = rootPlugin?.inject('command');
    const currentCount = commandService?.items?.length ?? 0;
    if (!commandPrefixIndex || currentCount !== lastCommandCount) {
      commandPrefixIndex = rebuildCommandIndex();
      lastCommandCount = currentCount;
    }
    return commandPrefixIndex;
  }

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

  function extractText(message: Message<any>): string {
    if (!message.$content) return '';
    return message.$content
      .map((seg: any) => {
        if (typeof seg === 'string') return seg;
        if (seg.type === 'text') return seg.data?.text || '';
        return '';
      })
      .join('')
      .trim();
  }

  function matchCommandInternal(message: Message<any>): boolean {
    const text = extractText(message);
    if (commandMatcher && commandMatcher(text, message)) return true;
    const index = getCommandIndex();
    for (const [prefix] of index) {
      if (text.startsWith(prefix)) return true;
    }
    return false;
  }

  function matchAIInternal(message: Message<any>): { triggered: boolean; content: string } {
    if (!aiTriggerMatcher) return { triggered: false, content: '' };
    return aiTriggerMatcher(message);
  }

  /** 互斥路由（与旧版 route 一致） */
  function routeExclusive(message: Message<any>): RouteResult {
    const text = extractText(message);

    if (commandMatcher && commandMatcher(text, message)) {
      return { type: 'command' };
    }

    const index = getCommandIndex();
    for (const [prefix] of index) {
      if (text.startsWith(prefix)) {
        return { type: 'command' };
      }
    }

    if (aiTriggerMatcher) {
      const { triggered, content } = aiTriggerMatcher(message);
      if (triggered) {
        return { type: 'ai', content };
      }
    }

    return { type: 'skip' };
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
    }
    pendingOutboundPolish.length = 0;
  }

  async function replyWithPolishInternal(
    message: Message<any>,
    source: ReplySource,
    content: SendContent,
  ): Promise<unknown> {
    if (!rootPlugin) {
      return message.$reply(content);
    }
    return outboundReplyAls.run({ message, source }, () => message.$reply(content));
  }

  async function runCommandBranch(message: Message<any>): Promise<void> {
    if (!rootPlugin) return;
    const commandService = rootPlugin.inject('command');
    if (!commandService) return;
    const response = await commandService.handle(message, rootPlugin);
    if (response) {
      await replyWithPolishInternal(message, 'command', response);
    }
  }

  const service: MessageDispatcherService = {
    async dispatch(message: Message<any>) {
      const passed = await runGuardrails(message);
      if (!passed) return;

      const cfg = dualRoute;

      if (cfg.mode === 'exclusive') {
        const result = routeExclusive(message);
        switch (result.type) {
          case 'command':
            await runCommandBranch(message);
            break;
          case 'ai':
            if (aiHandler) await aiHandler(message, result.content);
            break;
          default:
            break;
        }
        return;
      }

      // dual 模式
      let wantCmd = matchCommandInternal(message);
      const aiRes = matchAIInternal(message);
      let wantAi = aiRes.triggered;

      if (!wantCmd && !wantAi) {
        return;
      }

      if (!cfg.allowDualReply && wantCmd && wantAi) {
        if (cfg.order === 'command-first') wantAi = false;
        else wantCmd = false;
      }

      const runCmd = async () => {
        if (wantCmd) await runCommandBranch(message);
      };
      const runAi = async () => {
        if (wantAi && aiHandler) await aiHandler(message, aiRes.content);
      };

      if (cfg.order === 'ai-first') {
        await runAi();
        await runCmd();
      } else {
        await runCmd();
        await runAi();
      }
    },

    addGuardrail(guardrail: GuardrailMiddleware) {
      guardrails.push(guardrail);
      return () => {
        const index = guardrails.indexOf(guardrail);
        if (index !== -1) guardrails.splice(index, 1);
      };
    },

    setCommandMatcher(matcher: CommandMatcher) {
      commandMatcher = matcher;
    },

    setAITriggerMatcher(matcher: AITriggerMatcher) {
      aiTriggerMatcher = matcher;
    },

    setAIHandler(handler: AIHandler) {
      aiHandler = handler;
    },

    hasAIHandler() {
      return aiHandler !== null;
    },

    setDualRouteConfig(config: Partial<DualRouteConfig>) {
      dualRoute = resolveDualRouteConfig({ ...dualRoute, ...config });
    },

    getDualRouteConfig() {
      return { ...dualRoute };
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
      };
    },

    replyWithPolish(message, source, content) {
      return replyWithPolishInternal(message, source, content);
    },

    matchCommand(message) {
      return matchCommandInternal(message);
    },

    matchAI(message) {
      return matchAIInternal(message);
    },
  };

  return {
    name: 'dispatcher',
    description: '消息调度器 — 统一消息路由分流 (Command / AI)',
    value: service,
    mounted(plugin: Plugin) {
      rootPlugin = plugin.root;
      flushPendingOutboundPolish();
      return service;
    },
    extensions: {
      addGuardrail(guardrail: GuardrailMiddleware) {
        const plugin = getPlugin();
        const dispose = service.addGuardrail(guardrail);
        plugin.onDispose(dispose);
        return dispose;
      },
      addOutboundPolish(handler: OutboundPolishMiddleware) {
        const plugin = getPlugin();
        const dispose = service.addOutboundPolish(handler);
        plugin.onDispose(dispose);
        return dispose;
      },
    },
  };
}
