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
 *   │  精确命令 → Command 快速路径            │
 *   │  其它消息 → AI Agent 路径               │
 *   └──────────────┬─────────────────────────┘
 *                  ▼
 *   ┌────────────────────────────────────────┐
 *   │  Stage 3: Handle（处理）                │
 *   │  Command: commandService.handle()      │
 *   │  AI: aiHandler (由 AI 模块注册)         │
 *   └────────────────────────────────────────┘
 *
 * 注意：Context key 为 'dispatcher'，避免与 HTTP 模块的 'router' 冲突。
 */

import { Message } from '../message.js';
import { Plugin, getPlugin } from '../plugin.js';
import type {
  MessageMiddleware,
  RegisteredAdapter,
  AdapterMessage,
  MaybePromise,
  ToolContext,
  Tool,
} from '../types.js';
import type { Context } from '../plugin.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 路由判定结果
 */
export type RouteResult =
  | { type: 'command' }    // 精确命令 → Command 快速路径
  | { type: 'ai'; content: string }  // 自然语言 → AI Agent 路径
  | { type: 'skip' };     // 不处理（被 Guardrail 拦截等）

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
 * 返回 true 表示该消息是精确命令调用
 */
export type CommandMatcher = (text: string, message: Message<any>) => boolean;

/**
 * AI 触发判定函数
 * 返回 { triggered, content } 表示是否应该触发 AI 以及提取的内容
 */
export type AITriggerMatcher = (message: Message<any>) => { triggered: boolean; content: string };

/**
 * Guardrail 中间件
 * 与 MessageMiddleware 签名一致，但语义上只用于鉴权/限流/安全/日志
 * 返回 false 或抛异常表示拦截消息
 */
export type GuardrailMiddleware = MessageMiddleware<RegisteredAdapter>;

// ============================================================================
// MessageDispatcher 服务
// ============================================================================

/**
 * MessageDispatcher 服务接口
 */
export interface MessageDispatcherService {
  /**
   * 调度一条消息 — 这是唯一的入口
   * Adapter 的 message.receive 事件应该调用此方法
   */
  dispatch(message: Message<any>): Promise<void>;

  /**
   * 注册 Guardrail（护栏中间件）
   * Guardrail 始终执行，用于鉴权、限流、安全过滤、日志等
   * @returns 移除函数
   */
  addGuardrail(guardrail: GuardrailMiddleware): () => void;

  /**
   * 设置命令匹配器
   * 用于判定消息是否为精确命令调用
   * 默认：检查消息是否以已注册命令的 pattern 开头
   */
  setCommandMatcher(matcher: CommandMatcher): void;

  /**
   * 设置 AI 触发判定器
   * 用于判定消息是否应该触发 AI 处理
   * 由 AI 模块注册
   */
  setAITriggerMatcher(matcher: AITriggerMatcher): void;

  /**
   * 注册 AI 处理函数
   * 由 AI 模块注册，当消息路由到 AI 路径时调用
   */
  setAIHandler(handler: AIHandler): void;

  /**
   * 获取当前是否已注册 AI 处理能力
   */
  hasAIHandler(): boolean;
}

// ============================================================================
// 扩展 Plugin 接口
// ============================================================================

export interface DispatcherContextExtensions {
  /** 注册 Guardrail（护栏中间件） */
  addGuardrail(guardrail: GuardrailMiddleware): () => void;
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

/**
 * 创建 MessageDispatcher Context
 */
export function createMessageDispatcher(): Context<'dispatcher', DispatcherContextExtensions> {
  // 护栏中间件列表
  const guardrails: GuardrailMiddleware[] = [];

  // AI 处理函数（由 AI 模块注册）
  let aiHandler: AIHandler | null = null;

  // AI 触发判定器（由 AI 模块注册）
  let aiTriggerMatcher: AITriggerMatcher | null = null;

  // 命令匹配器（默认由 command service 驱动）
  let commandMatcher: CommandMatcher | null = null;

  // 根插件引用（mounted 时设置）
  let rootPlugin: Plugin | null = null;

  /**
   * 执行 Guardrail 管道
   * 返回 true 表示消息通过，false 表示被拦截
   */
  async function runGuardrails(message: Message<any>): Promise<boolean> {
    if (guardrails.length === 0) return true;

    let passed = true;
    let index = 0;

    const runNext = async (): Promise<void> => {
      if (index >= guardrails.length) return;
      const guardrail = guardrails[index++];
      try {
        await guardrail(message, runNext);
      } catch {
        // Guardrail 抛异常 → 拦截消息
        passed = false;
      }
    };

    await runNext();
    return passed;
  }

  /**
   * 路由判定：这条消息该走哪条路径？
   */
  function route(message: Message<any>): RouteResult {
    // 提取文本内容
    const text = extractText(message);

    // 1. 如果有自定义命令匹配器，优先使用
    if (commandMatcher && commandMatcher(text, message)) {
      return { type: 'command' };
    }

    // 2. 默认命令匹配：检查 commandService
    if (rootPlugin) {
      const commandService = rootPlugin.inject('command');
      if (commandService?.items) {
        for (const cmd of commandService.items) {
          const pattern = cmd.pattern?.split(/\s/)[0];
          if (pattern && text.startsWith(pattern)) {
            return { type: 'command' };
          }
        }
      }
    }

    // 3. AI 触发判定
    if (aiTriggerMatcher) {
      const { triggered, content } = aiTriggerMatcher(message);
      if (triggered) {
        return { type: 'ai', content };
      }
    }

    // 4. 都不匹配 → 跳过
    return { type: 'skip' };
  }

  /**
   * 提取消息文本（简单实现，与 ai-trigger 中的 extractTextContent 对齐）
   */
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

  // ─── 服务实例 ───────────────────────────────────────────────────────────

  const service: MessageDispatcherService = {
    async dispatch(message: Message<any>) {
      // Stage 1: Guardrail
      const passed = await runGuardrails(message);
      if (!passed) return;

      // Stage 2: Route
      const result = route(message);

      // Stage 3: Handle
      switch (result.type) {
        case 'command': {
          // 命令快速路径 — 直接委托给 commandService
          if (rootPlugin) {
            const commandService = rootPlugin.inject('command');
            if (commandService) {
              const response = await commandService.handle(message, rootPlugin);
              if (response) {
                await message.$reply(response);
              }
            }
          }
          break;
        }

        case 'ai': {
          // AI Agent 路径
          if (aiHandler) {
            await aiHandler(message, result.content);
          }
          break;
        }

        case 'skip':
        default:
          // 不处理
          break;
      }

      // 兼容：仍然执行旧的中间件链（除了默认的命令中间件和 AI 触发中间件）
      // 这样既有 Guardrail/Dispatcher 新逻辑，又不会丢失已有的自定义中间件
      // Phase 1 阶段先保持兼容，后续逐步迁移
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
  };

  return {
    name: 'dispatcher',
    description: '消息调度器 — 统一消息路由分流 (Command / AI)',
    value: service,
    mounted(plugin: Plugin) {
      rootPlugin = plugin.root;
      return service;
    },
    extensions: {
      addGuardrail(guardrail: GuardrailMiddleware) {
        const plugin = getPlugin();
        const dispose = service.addGuardrail(guardrail);
        plugin.onDispose(dispose);
        return dispose;
      },
    },
  };
}
