/** Proactive delivery contracts implemented by the generation-owned IM runtime. */
import type { IMSceneRef, SendContent } from '@zhin.js/core';
import type { OutputElement } from '@zhin.js/ai';

export type ProactiveSendSource =
  | 'scheduled'
  | 'notification'
  | 'ask_user'
  | 'subagent'
  | 'host';

export interface ProactiveSendContext {
  scene: IMSceneRef;
  source: ProactiveSendSource;
  quoteMessageId?: string;
}

export interface ProactiveOutboundService {
  send(ctx: ProactiveSendContext, content: SendContent): Promise<string>;
  sendElements(ctx: ProactiveSendContext, elements: OutputElement[]): Promise<string[]>;
}
