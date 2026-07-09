import {
  enrichMessageForAgent,
  resolveQuoteContextBlock,
  QUOTE_CONTEXT_BLOCK_EXTRA_KEY,
  QUOTE_CONTEXT_SYSTEM_EXTRA_KEY,
  QUOTE_CONTEXT_SYSTEM_HINT,
  QUOTED_MESSAGE_CONTEXT_MARKER,
  resolveQuotedMessagePayload,
  type Message,
  type AgentTurnMessage,
  type Plugin,
} from '@zhin.js/core';
import { formatCompactLog, truncatePreview } from '@zhin.js/logger';
import type { ContentPart } from '@zhin.js/ai';
import { extractMediaParts, extractMediaPartsFromQuotedPayload } from '../init/message-media.js';
import {
  formatSubagentProcessingMessage,
  SUBAGENT_GOAL_NOTIFY_EXTRA_KEY,
  shouldSuppressSubagentGoalNotifyToIm,
  type SubagentProcessingNotice,
} from '../subagent-goal-notify.js';
import type { CollaborationScene } from './types.js';

export interface InboundTurnEnrichmentInput {
  root: Plugin;
  message: Message;
  content: string;
  cell: CollaborationScene | undefined;
  resolveQuotes: boolean;
  replyOutbound: (payload: unknown, options?: { quote?: boolean }) => Promise<unknown>;
  logger: { debug: (...args: unknown[]) => void };
  t0: number;
}

export interface InboundTurnEnrichment {
  commMessage: AgentTurnMessage;
  mediaParts: ContentPart[];
  aiContent: string;
  onChunk: (chunk: string, full: string) => void;
}

export async function prepareInboundTurnEnrichment(
  input: InboundTurnEnrichmentInput,
): Promise<InboundTurnEnrichment> {
  const { root, message, content, cell, resolveQuotes, replyOutbound, logger, t0 } = input;

  enrichMessageForAgent(root, message);
  const commMessage = message as AgentTurnMessage;
  commMessage.extra = {
    ...(commMessage.extra ?? {}),
    [SUBAGENT_GOAL_NOTIFY_EXTRA_KEY]: async (notice: SubagentProcessingNotice) => {
      if (shouldSuppressSubagentGoalNotifyToIm(message, cell)) {
        logger.debug(formatCompactLog('SubagentGoal', {
          suppress_im: true,
          cell: cell?.id,
          taskId: notice.taskId,
          kind: notice.kind,
          label: truncatePreview(notice.label),
        }));
        return;
      }
      await replyOutbound(formatSubagentProcessingMessage(notice));
    },
  };

  let mediaParts = extractMediaParts(message);
  if (message.$quote_id && resolveQuotes) {
    const quoted = await resolveQuotedMessagePayload(message, root, { enabled: true });
    if (quoted) {
      const fromQuote = extractMediaPartsFromQuotedPayload(quoted, message.$adapter);
      if (fromQuote.length) mediaParts = [...fromQuote, ...mediaParts];
    }
  }

  let firstChunkMs = 0;
  const onChunk: (chunk: string, full: string) => void = () => {
    if (!firstChunkMs) {
      firstChunkMs = performance.now() - t0;
      logger.debug(formatCompactLog('AI Handler', { first_token_ms: Math.round(firstChunkMs) }));
    }
  };

  const quoteBlock = await resolveQuoteContextBlock(message, root, { enabled: resolveQuotes });
  if (quoteBlock?.includes(QUOTED_MESSAGE_CONTEXT_MARKER)) {
    commMessage.extra = {
      ...commMessage.extra,
      [QUOTE_CONTEXT_BLOCK_EXTRA_KEY]: quoteBlock,
      [QUOTE_CONTEXT_SYSTEM_EXTRA_KEY]: QUOTE_CONTEXT_SYSTEM_HINT,
    };
  }

  return { commMessage, mediaParts, aiContent: content, onChunk };
}
