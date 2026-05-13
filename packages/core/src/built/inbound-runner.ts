/**
 * Inbound runner — one ordered entry for IM message.receive processing.
 */

import type { Message } from '../message.js';
import type { Plugin } from '../plugin.js';
import type { MessageDispatcherService } from './dispatcher.js';

export interface RunInboundMessageOptions {
  plugin?: Plugin | null;
  message: Message<any>;
  emitAdapterObservers: () => void;
}

export interface InboundRunResult {
  dispatched: boolean;
}

function getDispatcher(plugin?: Plugin | null): MessageDispatcherService | undefined {
  const dispatcher = plugin?.inject('dispatcher');
  if (dispatcher && typeof dispatcher.dispatch === 'function') {
    return dispatcher as MessageDispatcherService;
  }
  return undefined;
}

/**
 * Ordered IM inbound pipeline:
 * dispatcher/guardrails/routes -> plugin lifecycle -> adapter observers.
 *
 * Plugin middleware remains a legacy/manual seam and is not invoked here.
 */
export async function runInboundMessage(options: RunInboundMessageOptions): Promise<InboundRunResult> {
  const { plugin, message, emitAdapterObservers } = options;
  const dispatcher = getDispatcher(plugin);
  if (dispatcher) {
    await dispatcher.dispatch(message);
  }
  plugin?.dispatch('message.receive', message);
  emitAdapterObservers();
  return { dispatched: !!dispatcher };
}

