/**
 * Compatibility facade for the pre-Plugin-Runtime inbound entry point.
 * New applications are assembled by the runtime host; this facade keeps the
 * public API usable without reviving the removed staged pipeline modules.
 */
import type { AITriggerConfig, Message, Plugin } from '@zhin.js/core';
import type { AIServiceRefs } from '../internal/ai-service-refs.js';
import type { AIService } from '../service.js';
import type { PeerTriggerMode } from './types.js';

export interface InboundTurnPipelineDeps {
  root: Plugin;
  ai: AIService;
  refs: AIServiceRefs;
  triggerConfig: AITriggerConfig;
  peerMode: PeerTriggerMode;
  logger: { debug: (...args: unknown[]) => void; info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  replyOutbound: (payload: unknown, options?: { quote?: boolean }) => Promise<unknown>;
}

export type InboundTurnPipeline = (message: Message, content: string) => Promise<void>;

/**
 * Run the current Agent turn surface behind the former public factory.
 * Collaboration routing now belongs to the runtime host, so this adapter only
 * preserves the standalone local-turn contract.
 *
 * @deprecated 生产零调用（仅 public-compat 测试锁定），下个大版本删除。
 */
export function createInboundTurnPipeline(deps: InboundTurnPipelineDeps): InboundTurnPipeline {
  return async (message, content) => {
    if (!deps.ai.isReady()) {
      await deps.replyOutbound('AI 服务未就绪，请检查 zhin.config.yml 中的 providers 配置。');
      return;
    }

    const agent = deps.refs.zhinAgent;
    if (!agent) {
      await deps.replyOutbound('AI Agent 未初始化，请查看启动日志。');
      return;
    }

    try {
      agent.initInboundTurnContext?.();
      const tools = deps.ai.getResidentToolsAsTools?.() ?? [];
      const elements = await agent.process(content, message, tools);
      await deps.replyOutbound(elements);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      deps.logger.warn('compat inbound Agent turn failed', messageText);
      await deps.replyOutbound(
        (deps.triggerConfig.errorTemplate ?? '❌ AI 处理失败: {error}').replace('{error}', messageText),
      );
    }
  };
}
