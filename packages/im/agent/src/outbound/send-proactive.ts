import type { AgentOutputElement } from './agent-output.js';
/** Proactive delivery contracts implemented by the generation-owned IM runtime. */
import type { IMSceneRef, SendContent } from '@zhin.js/core';

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
  sendElements(ctx: ProactiveSendContext, elements: AgentOutputElement[]): Promise<string[]>;
}
