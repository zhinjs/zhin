/**
 * Branch summarization on session tree switch — ADR 0010 D3.
 */

import {
  abandonedRowsToMessages,
  collectAbandonedPathRows,
  compactAgentMessages,
  estimateAgentMessagesTokens,
  getModel,
  parseAgentMessageRow,
} from '@zhin.js/ai';
import type { CompactionConfig } from './config.js';
import type { ZhinAgentPrivate } from './zhin-agent-private.js';

export interface BranchSummarizationOptions {
  compactionConfig?: CompactionConfig;
  contextWindow?: number;
}

export async function summarizeAbandonedBranchIfNeeded(
  host: ZhinAgentPrivate,
  sessionId: string,
  oldLeafId: number | null | undefined,
  newLeafId: number,
  options: BranchSummarizationOptions = {},
): Promise<void> {
  const compaction = options.compactionConfig ?? host.config.compaction;
  if (compaction?.enabled === false) return;
  if (oldLeafId == null || oldLeafId === newLeafId) return;

  if (await host.contextRepository.hasBranchSummary(sessionId, newLeafId)) return;

  const allRows = await host.contextRepository.loadMessageRows(sessionId);
  const abandoned = collectAbandonedPathRows(allRows, oldLeafId, newLeafId);
  if (abandoned.length === 0) return;

  const messages = abandonedRowsToMessages(abandoned);
  const keepRecentTokens = compaction?.keepRecentTokens ?? 20_000;
  if (estimateAgentMessagesTokens(messages) <= keepRecentTokens) return;

  const provider = host.getTurnProvider();
  const modelId = host.config.chatModel || provider.models[0] || '';
  const llmModel = getModel(provider.name, modelId);
  const contextWindow = options.contextWindow ?? llmModel.contextWindow ?? host.config.contextTokens;

  const result = await compactAgentMessages({
    model: llmModel,
    messages,
    contextWindow,
    keepRecentTokens: Math.min(keepRecentTokens, Math.max(500, Math.floor(messages.length * 200))),
    minKeepCount: 1,
    customInstructions:
      'Summarize this abandoned conversation branch so it can be recalled later if the user returns to it.',
  });

  if (!result.summary?.trim()) return;

  await host.contextRepository.saveSummary(sessionId, result.summary, {
    branchAnchorMessageId: newLeafId,
  });
}

export async function switchActiveLeafWithBranchSummarization(
  host: ZhinAgentPrivate,
  sessionId: string,
  messageId: number,
  options: BranchSummarizationOptions = {},
): Promise<boolean> {
  const session = await host.agentSessionStore.getBySessionId(sessionId);
  const oldLeaf = session?.active_leaf_message_id;
  if (oldLeaf === messageId) return true;

  await summarizeAbandonedBranchIfNeeded(host, sessionId, oldLeaf, messageId, options);
  return host.contextRepository.setActiveLeaf(sessionId, messageId);
}

export async function jumpToBranchIndexWithSummarization(
  host: ZhinAgentPrivate,
  sessionId: string,
  index: number,
  options: BranchSummarizationOptions = {},
): Promise<{ ok: boolean; message: string }> {
  const points = await host.contextRepository.listBranchPoints(sessionId);
  const point = points.find(p => p.index === index);
  if (!point) {
    return { ok: false, message: `未找到分支点 #${index}` };
  }
  const ok = await switchActiveLeafWithBranchSummarization(
    host,
    sessionId,
    point.messageId,
    options,
  );
  return ok
    ? { ok: true, message: `已跳转到分支点 #${index}：${point.preview}` }
    : { ok: false, message: '跳转失败' };
}
