/**
 * InboundMessagePipeline — ordered IM inbound pipeline for adapter message.receive.
 *
 * Extracted from Adapter.emit() override to improve testability and decoupling.
 * Handles: event routing, logging, backpressure, pipeline execution, observer emission.
 */

import type { Logger } from '@zhin.js/logger';
import { formatCompact, truncatePreview } from '@zhin.js/logger';
import { segment } from '../utils.js';
import { type Message as MessageType } from '../message.js';
import type { Plugin } from '../plugin.js';
import { runInboundMessage } from './inbound-runner.js';

export interface InboundPipelineOptions {
  plugin: Plugin | null;
  logger: Logger;
  getMaxConcurrentMessages: () => number;
  getPendingMessages: () => number;
  decrementPending: () => void;
}

export class InboundMessagePipeline {
  constructor(private readonly options: InboundPipelineOptions) {}

  /**
   * Check if message should be dropped due to backpressure (sync check).
   * Call this BEFORE receive() to match original emit() backpressure contract.
   */
  shouldDropDueToBackpressure(): boolean {
    const limit = this.options.getMaxConcurrentMessages();
    return limit > 0 && this.options.getPendingMessages() >= limit;
  }

  /**
   * Process a message.receive event through the full inbound pipeline:
   * 1. Logging (caller should have already logged via emit)
   * 2. runInboundMessage (middleware → dispatcher → lifecycle)
   * 3. Adapter observer emission
   *
   * Note: backpressure check is done by the caller via shouldDropDueToBackpressure()
   */
  async receive(message: MessageType<any>, emitAdapterObservers: () => void): Promise<void> {
    this.logIncoming(message);
    try {
      await runInboundMessage({
        plugin: this.options.plugin,
        message,
        emitAdapterObservers,
      });
    } catch (e) {
      this.options.logger.warn(
        `message.receive handling error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.options.decrementPending();
    }
  }

  /** Bridge notice/request events to plugin dispatch */
  bridgeNoticeOrRequest(event: string, args: unknown[], directEmit: () => boolean): boolean {
    const result = directEmit();
    if (this.options.plugin) {
      void this.options.plugin.dispatch(event as 'notice.receive' | 'request.receive', args[0] as never);
    }
    return result;
  }

  private logIncoming(message: MessageType<any>): void {
    this.options.logger.info(formatCompact( {
      recv: `${message.$channel.type}(${message.$channel.id})`,
      endpoint: message.$endpoint,
      preview: truncatePreview(segment.raw(message.$content)),
      ...(message.$quote_id ? { quote_id: message.$quote_id } : {}),
    }));
  }
}
