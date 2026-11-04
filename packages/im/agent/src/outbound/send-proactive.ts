import type { AgentOutputElement } from './agent-output.js';
/** Proactive delivery contracts implemented by the generation-owned IM runtime. */
import type { IMSceneRef, SendContent } from '@zhin.js/core';
import type { Locale } from '@zhin.js/plugin-runtime';
import type { DeliveryReceipt } from '@zhin.js/im-contract';

export type ProactiveSendSource =
  | 'scheduled'
  | 'notification'
  | 'ask_user'
  | 'host';

export interface ProactiveSendContext {
  locale?: Locale;
  scene: IMSceneRef;
  source: ProactiveSendSource;
  quoteMessageId?: string;
  /** Optional observation of the same unified send; never a retry or delivery gate. */
  onReceipt?: (receipt: DeliveryReceipt) => void | Promise<void>;
}

export interface ProactiveOutboundService {
  send(ctx: ProactiveSendContext, content: SendContent): Promise<string>;
  sendElements(ctx: ProactiveSendContext, elements: AgentOutputElement[]): Promise<string[]>;
  /** Media limits the target Endpoint declares for this scene (ADR 0044); absent = nothing assumed. */
  mediaCapabilities?(scene: IMSceneRef): import('../media/media-types.js').OutboundMediaCapabilities | undefined;
}
