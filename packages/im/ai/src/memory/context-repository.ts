/**
 * ContextRepository — epoch-only LLM context load/save (ADR 0009 D4 / Grill #15).
 */

import { createUserMessage, type AgentMessage, type UserMessage } from '../llm/types/agent-message.js';

import { createContext, type Context } from '../llm/types/context.js';

import { agentMessageRowToLlm, serializeAgentMessage, type AgentMessageRow, type AgentSummaryRecord } from './agent-db-models.js';
import type { AgentMessageExtra } from './user-message-presentation.js';

import { findKeepRecentStartIndex } from '../compaction/agent-message-tokens.js';
import {
  MemoryAgentSessionStore,
  type AgentSessionRepository,
} from './agent-session-store.js';
import { branchSummaryAsUserMessage } from './branch-summarization.js';
import {
  buildActivePathRows,
  listUserBranchPoints,
  sortRowsChronologically,
  type SessionBranchPoint,
} from './session-tree.js';
import { assignRowAliasMetadata } from './message-alias.js';
import { SessionWriteLock } from './session-write-lock.js';
import { EMPTY_DEFERRED_TOOL_SNAPSHOT, type DeferredToolSessionSnapshot } from './deferred-tool-session.js';
import { persistenceFailure } from './persistence-error.js';

export interface ContextRepositoryConfig {
  /** Max messages loaded per session epoch (tail). */
  tailMessageLimit?: number;
}

export interface SaveSummaryOptions {
  anchorMessageId?: number;
  branchAnchorMessageId?: number;
}

export interface AppendMessagesOptions {
  /** 与 `messages` 同下标；仅承载引用等展示上下文。 */
  messageExtras?: (AgentMessageExtra | undefined)[];
}

export interface SessionBranchJumpResult {
  ok: boolean;
  message: string;
  /** Structured presentation facts; custom repositories may retain their own message. */
  code?: 'not_found' | 'switched' | 'failed';
  preview?: string;
}

export interface ContextRepository {
  loadContext(sessionId: string): Promise<Context>;
  loadMessageRows(sessionId: string): Promise<AgentMessageRow[]>;
  appendMessages(
    sessionId: string,
    messages: AgentMessage[],
    options?: AppendMessagesOptions,
  ): Promise<void>;
  archiveSession(sessionKey: string): Promise<boolean>;
  saveSummary(
    sessionId: string,
    summary: string,
    anchorOrOptions?: number | SaveSummaryOptions,
  ): Promise<void>;
  /** Save only a proven prefix from loadContext, under the session write lock.
   * Returns false for unpersisted/stale input. Custom repositories may omit it;
   * compaction then affects only the current projection, never a guessed checkpoint.
   */
  saveCompactionSummary?(
    sessionId: string,
    summary: string,
    compactedMessages: readonly AgentMessage[],
    signal?: AbortSignal,
  ): Promise<boolean>;
  hasBranchSummary(sessionId: string, branchAnchorMessageId: number): Promise<boolean>;
  /** Last row id of messages that would be summarized (for compaction anchor). */
  resolveCompactionAnchorId(
    sessionId: string,
    keepRecentTokens: number,
    minKeepCount?: number,
  ): Promise<number | undefined>;
  listBranchPoints(sessionId: string): Promise<SessionBranchPoint[]>;
  setActiveLeaf(sessionId: string, messageId: number): Promise<boolean>;
  jumpToBranchIndex(sessionId: string, index: number): Promise<SessionBranchJumpResult>;
  getDeferredToolSnapshot(sessionId: string): Promise<DeferredToolSessionSnapshot>;
  setDeferredToolSnapshot(sessionId: string, snapshot: DeferredToolSessionSnapshot): Promise<void>;
}

type SqlInsertResult = {
  lastID?: number;
  insertId?: number | string;
  changes?: number;
};

type MessageDbModel = {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): MessageWhereResult;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
  insert?(data: Record<string, unknown>): Promise<SqlInsertResult>;
};

/** Insert exactly once; dialects without an insert id are reconciled by the caller's tail query. */
async function insertAgentMessageRow(
  model: MessageDbModel,
  row: AgentMessageRow,
): Promise<number | undefined> {
  const payload = row as unknown as Record<string, unknown>;
  if (typeof model.insert === 'function') {
    const result = await model.insert(payload);
    const insertedId = Number(result?.lastID ?? result?.insertId);
    return Number.isSafeInteger(insertedId) && insertedId > 0 ? insertedId : undefined;
  }
  const created = await model.create(payload);
  const id = (created as { id?: number })?.id;
  return id != null && id > 0 ? id : undefined;
}

type SummaryDbModel = {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): SummaryWhereResult;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
};

type MessageWhereResult =
  | PromiseLike<AgentMessageRow[]>
  | {
      orderBy(field: string, dir: 'ASC' | 'DESC'): {
        limit(n: number): PromiseLike<AgentMessageRow[]>;
      };
    };

type SummaryWhereResult =
  | PromiseLike<AgentSummaryRecord[]>
  | {
      orderBy(field: string, dir: 'ASC' | 'DESC'): {
        limit(n: number): PromiseLike<AgentSummaryRecord[]>;
      };
    };

function isMessageQueryChain(result: MessageWhereResult): result is {
  orderBy(field: string, dir: 'ASC' | 'DESC'): {
    limit(n: number): PromiseLike<AgentMessageRow[]>;
  };
} {
  return (
    result != null &&
    typeof result === 'object' &&
    'orderBy' in result &&
    typeof (result as { orderBy?: unknown }).orderBy === 'function'
  );
}

function isSummaryQueryChain(result: SummaryWhereResult): result is {
  orderBy(field: string, dir: 'ASC' | 'DESC'): {
    limit(n: number): PromiseLike<AgentSummaryRecord[]>;
  };
} {
  return (
    result != null &&
    typeof result === 'object' &&
    'orderBy' in result &&
    typeof (result as { orderBy?: unknown }).orderBy === 'function'
  );
}

const SUMMARY_PREFIX = '[Previous conversation summary]\n';

function filterRowsAfterAnchor(
  rows: AgentMessageRow[],
  anchorMessageId?: number,
): AgentMessageRow[] {
  if (anchorMessageId == null || anchorMessageId <= 0) return rows;
  return rows.filter(row => (row.id ?? 0) > anchorMessageId);
}

function summaryAsUserMessage(summary: string, createdAt: number): UserMessage {
  return createUserMessage(`${SUMMARY_PREFIX}${summary}`, undefined, createdAt);
}

function resolveSaveSummaryOptions(
  anchorOrOptions?: number | SaveSummaryOptions,
): SaveSummaryOptions {
  if (typeof anchorOrOptions === 'number') {
    return { anchorMessageId: anchorOrOptions };
  }
  return anchorOrOptions ?? {};
}

/** Repository-owned provenance; no row IDs leak into provider messages. */
class CompactionCheckpoints {
  private readonly sources = new WeakMap<AgentMessage, {
    snapshot: { sessionId: string; revision: string; anchors: (number | undefined)[] };
    index: number;
  }>();

  register(sessionId: string, revision: string, messages: AgentMessage[], anchors: (number | undefined)[]): void {
    const snapshot = { sessionId, revision, anchors };
    messages.forEach((message, index) => this.sources.set(message, { snapshot, index }));
  }

  resolve(sessionId: string, revision: string, prefix: readonly AgentMessage[]): number | undefined {
    const first = prefix[0] && this.sources.get(prefix[0]);
    if (!first || first.snapshot.sessionId !== sessionId || first.snapshot.revision !== revision) return undefined;
    for (let index = 0; index < prefix.length; index += 1) {
      const source = this.sources.get(prefix[index]!);
      if (source?.snapshot !== first.snapshot || source.index !== index) return undefined;
    }
    const anchor = first.snapshot.anchors[prefix.length - 1];
    // A branch summary follows its raw anchor. Cutting between them would drop
    // the retained summary on reload; an unpersisted turn cannot be an anchor.
    if (anchor == null || anchor <= 0 || first.snapshot.anchors[prefix.length] === anchor) return undefined;
    return anchor;
  }
}

function contextRevision(path: AgentMessageRow[], summaries: AgentSummaryRecord[]): string {
  // Both stores append immutable rows. IDs identify revisions even when timestamps collide.
  return JSON.stringify([path.map(row => row.id), summaries.map(row => [row.id, row.anchor_message_id, row.branch_anchor_message_id])]);
}

export class DatabaseContextRepository implements ContextRepository {
  private readonly messageModel: MessageDbModel;
  private readonly summaryModel: SummaryDbModel;
  private readonly sessionStore: AgentSessionRepository;
  private readonly writeLock = new SessionWriteLock();
  private readonly checkpoints = new CompactionCheckpoints();
  private readonly config: Required<Pick<ContextRepositoryConfig, 'tailMessageLimit'>>;
  private readonly deferredToolSnapshots = new Map<string, DeferredToolSessionSnapshot>();

  constructor(
    messageModel: MessageDbModel,
    summaryModel: SummaryDbModel,
    sessionStore: AgentSessionRepository,
    config: ContextRepositoryConfig = {},
  ) {
    this.messageModel = messageModel;
    this.summaryModel = summaryModel;
    this.sessionStore = sessionStore;
    this.config = {
      tailMessageLimit: config.tailMessageLimit ?? 100,
    };
  }

  async loadMessageRows(sessionId: string): Promise<AgentMessageRow[]> {
    return this.loadAllMessageRows(sessionId);
  }

  async loadContext(sessionId: string): Promise<Context> {
    const summaryRows = await this.loadAllSummaryRows(sessionId);
    const summary = summaryRows.filter(row => row.branch_anchor_message_id == null).at(-1);
    const allRows = await this.loadAllMessageRows(sessionId);
    const session = await this.sessionStore.getBySessionId(sessionId);
    const pathRows = buildActivePathRows(allRows, session?.active_leaf_message_id);
    const filtered = summary?.anchor_message_id
      ? pathRows.filter(row => (row.id ?? 0) > summary.anchor_message_id!)
      : pathRows;
    const tail = filtered.length > this.config.tailMessageLimit
      ? filtered.slice(-this.config.tailMessageLimit)
      : filtered;
    const branchSummaries = new Map(summaryRows
      .filter(row => row.branch_anchor_message_id != null)
      .map(row => [row.branch_anchor_message_id!, row]));

    const messages: AgentMessage[] = [];
    const anchors: (number | undefined)[] = [];
    if (summary) {
      messages.push(summaryAsUserMessage(summary.summary, summary.created_at));
      anchors.push(summary.anchor_message_id ?? undefined);
    }
    const aliases = assignRowAliasMetadata(pathRows);
    for (const row of tail) {
      const parsed = agentMessageRowToLlm(row);
      if (parsed) {
        const metadata = aliases.get(row);
        messages.push(metadata && (parsed.role === 'user' || parsed.role === 'assistant') ? { ...parsed, ...metadata } : parsed);
        anchors.push(row.id);
      }
      if (row.id != null) {
        const branchSummary = branchSummaries.get(row.id);
        if (branchSummary) {
          messages.push(branchSummaryAsUserMessage(branchSummary.summary, branchSummary.created_at));
          anchors.push(row.id);
        }
      }
    }
    this.checkpoints.register(sessionId, contextRevision(pathRows, summaryRows), messages, anchors);
    return createContext('', messages);
  }

  async appendMessages(
    sessionId: string,
    newMessages: AgentMessage[],
    options?: AppendMessagesOptions,
  ): Promise<void> {
    if (newMessages.length === 0) return;
    await this.writeLock.run(sessionId, async () => {
      const allRows = await this.loadAllMessageRows(sessionId);
      const session = await this.sessionStore.getBySessionId(sessionId);
      let parentId = session?.active_leaf_message_id ?? buildActivePathRows(allRows).at(-1)?.id ?? null;
      let lastId: number | undefined;

      for (let i = 0; i < newMessages.length; i += 1) {
        const message = newMessages[i]!;
        const row = serializeAgentMessage(message, options?.messageExtras?.[i]);
        row.session_id = sessionId;
        row.parent_id = parentId;
        let id = await insertAgentMessageRow(this.messageModel, row);
        if (id == null) {
          const tail = sortRowsChronologically(await this.loadAllMessageRows(sessionId));
          id = tail.at(-1)?.id;
        }
        if (id != null) {
          parentId = id;
          lastId = id;
        }
      }
      if (lastId != null) {
        await this.sessionStore.setActiveLeafMessageId(sessionId, lastId);
      }
      await this.sessionStore.touch(sessionId);
    });
  }

  async archiveSession(sessionKey: string): Promise<boolean> {
    return this.sessionStore.archiveByKey(sessionKey);
  }

  async saveSummary(
    sessionId: string,
    summary: string,
    anchorOrOptions?: number | SaveSummaryOptions,
  ): Promise<void> {
    const text = summary.trim();
    if (!text) return;
    const opts = resolveSaveSummaryOptions(anchorOrOptions);
    await this.writeLock.run(sessionId, async () => {
      await this.insertSummary(sessionId, text, opts);
    });
  }

  async saveCompactionSummary(sessionId: string, summary: string, prefix: readonly AgentMessage[], signal?: AbortSignal): Promise<boolean> {
    return this.writeLock.run(sessionId, async () => {
      if (signal?.aborted || !summary.trim()) return false;
      const rows = await this.loadAllMessageRows(sessionId);
      const summaries = await this.loadAllSummaryRows(sessionId);
      const session = await this.sessionStore.getBySessionId(sessionId);
      const path = buildActivePathRows(rows, session?.active_leaf_message_id);
      const anchor = this.checkpoints.resolve(sessionId, contextRevision(path, summaries), prefix);
      if (signal?.aborted || anchor == null || !path.some(row => row.id === anchor)) return false;
      await this.insertSummary(sessionId, summary.trim(), { anchorMessageId: anchor });
      return true;
    });
  }

  private async insertSummary(sessionId: string, text: string, opts: SaveSummaryOptions): Promise<void> {
    await this.summaryModel.create({
      session_id: sessionId,
      summary: text,
      anchor_message_id: opts.anchorMessageId ?? null,
      branch_anchor_message_id: opts.branchAnchorMessageId ?? null,
      created_at: Date.now(),
    });
  }

  async hasBranchSummary(sessionId: string, branchAnchorMessageId: number): Promise<boolean> {
    const rows = await this.loadAllSummaryRows(sessionId);
    return rows.some(
      r => r.branch_anchor_message_id === branchAnchorMessageId && r.summary.trim().length > 0,
    );
  }

  async listBranchPoints(sessionId: string): Promise<SessionBranchPoint[]> {
    const allRows = await this.loadAllMessageRows(sessionId);
    const session = await this.sessionStore.getBySessionId(sessionId);
    return listUserBranchPoints(sortRowsChronologically(allRows), session?.active_leaf_message_id);
  }

  async setActiveLeaf(sessionId: string, messageId: number): Promise<boolean> {
    const allRows = await this.loadAllMessageRows(sessionId);
    if (!allRows.some(r => r.id === messageId)) return false;
    await this.writeLock.run(sessionId, async () => {
      await this.sessionStore.setActiveLeafMessageId(sessionId, messageId);
    });
    return true;
  }

  async jumpToBranchIndex(sessionId: string, index: number): Promise<SessionBranchJumpResult> {
    const points = await this.listBranchPoints(sessionId);
    const point = points.find(p => p.index === index);
    if (!point) {
      return { ok: false, code: 'not_found', message: `未找到分支点 #${index}` };
    }
    const ok = await this.setActiveLeaf(sessionId, point.messageId);
    return ok
      ? { ok: true, code: 'switched', preview: point.preview, message: `已跳转到分支点 #${index}：${point.preview}` }
      : { ok: false, code: 'failed', message: '跳转失败' };
  }

  async resolveCompactionAnchorId(
    sessionId: string,
    keepRecentTokens: number,
    minKeepCount = 2,
  ): Promise<number | undefined> {
    const session = await this.sessionStore.getBySessionId(sessionId);
    const rows = buildActivePathRows(
      await this.loadAllMessageRows(sessionId),
      session?.active_leaf_message_id,
    );
    const messages: AgentMessage[] = [];
    for (const row of rows) {
      const parsed = agentMessageRowToLlm(row);
      if (parsed) messages.push(parsed);
    }
    const startIdx = findKeepRecentStartIndex(messages, keepRecentTokens, minKeepCount);
    if (startIdx === 0) return undefined;
    const anchorRow = rows[startIdx - 1];
    return anchorRow?.id;
  }

  async getDeferredToolSnapshot(sessionId: string): Promise<DeferredToolSessionSnapshot> {
    return this.deferredToolSnapshots.get(sessionId) ?? { ...EMPTY_DEFERRED_TOOL_SNAPSHOT };
  }

  async setDeferredToolSnapshot(sessionId: string, snapshot: DeferredToolSessionSnapshot): Promise<void> {
    this.deferredToolSnapshots.set(sessionId, snapshot);
  }

  private async loadAllSummaryRows(sessionId: string): Promise<AgentSummaryRecord[]> {
    try {
      const probe = this.summaryModel.select().where({ session_id: sessionId });
      if (isSummaryQueryChain(probe)) {
        return ((await probe.orderBy('created_at', 'ASC').limit(500)) as AgentSummaryRecord[])
          .sort((a, b) => a.created_at - b.created_at || (a.id ?? 0) - (b.id ?? 0));
      }
      const rows = (await Promise.resolve(probe as PromiseLike<AgentSummaryRecord[]>)) ?? [];
      rows.sort((a, b) => a.created_at - b.created_at || (a.id ?? 0) - (b.id ?? 0));
      return rows;
    } catch (err) {
      throw persistenceFailure('agent_context.load_summaries', err);
    }
  }

  private async loadAllMessageRows(sessionId: string): Promise<AgentMessageRow[]> {
    try {
      const probe = this.messageModel.select().where({ session_id: sessionId });
      if (isMessageQueryChain(probe)) {
        const rows = (await probe.orderBy('timestamp', 'ASC').limit(10_000)) as AgentMessageRow[];
        return rows;
      }
      const rows = (await Promise.resolve(probe as PromiseLike<AgentMessageRow[]>)) ?? [];
      rows.sort((a, b) => a.timestamp - b.timestamp || (a.id ?? 0) - (b.id ?? 0));
      return rows;
    } catch (err) {
      throw persistenceFailure('agent_context.load_messages', err);
    }
  }
}

export class MemoryContextRepository implements ContextRepository {
  private readonly messages = new Map<string, AgentMessageRow[]>();
  private readonly summaries = new Map<string, AgentSummaryRecord[]>();
  private readonly sessionStore: AgentSessionRepository;
  private readonly writeLock = new SessionWriteLock();
  private readonly checkpoints = new CompactionCheckpoints();
  private readonly config: Required<Pick<ContextRepositoryConfig, 'tailMessageLimit'>>;
  private readonly deferredToolSnapshots = new Map<string, DeferredToolSessionSnapshot>();

  constructor(
    sessionStore: AgentSessionRepository,
    config: ContextRepositoryConfig = {},
  ) {
    this.sessionStore = sessionStore;
    this.config = {
      tailMessageLimit: config.tailMessageLimit ?? 100,
    };
  }

  async loadMessageRows(sessionId: string): Promise<AgentMessageRow[]> {
    const allRows = [...(this.messages.get(sessionId) ?? [])];
    allRows.sort((a, b) => a.timestamp - b.timestamp || (a.id ?? 0) - (b.id ?? 0));
    return allRows;
  }

  async loadContext(sessionId: string): Promise<Context> {
    const summaryList = [...(this.summaries.get(sessionId) ?? [])];
    const epochRows = summaryList.filter(r => r.branch_anchor_message_id == null);
    const latest = epochRows.sort((a, b) => a.created_at - b.created_at || (a.id ?? 0) - (b.id ?? 0)).at(-1);
    const allRows = await this.loadMessageRows(sessionId);
    const session = await this.sessionStore.getBySessionId(sessionId);
    const pathRows = buildActivePathRows(allRows, session?.active_leaf_message_id);
    const afterAnchor = filterRowsAfterAnchor(pathRows, latest?.anchor_message_id ?? undefined);
    const tail = afterAnchor.length > this.config.tailMessageLimit
      ? afterAnchor.slice(-this.config.tailMessageLimit)
      : afterAnchor;
    const pathIds = new Set(tail.map(r => r.id).filter((id): id is number => id != null));
    const branchMap = new Map<number, AgentSummaryRecord>();
    for (const row of summaryList) {
      const anchor = row.branch_anchor_message_id;
      if (anchor == null || !pathIds.has(anchor)) continue;
      branchMap.set(anchor, row);
    }

    const messages: AgentMessage[] = [];
    const anchors: (number | undefined)[] = [];
    if (latest) {
      messages.push(summaryAsUserMessage(latest.summary, latest.created_at));
      anchors.push(latest.anchor_message_id ?? undefined);
    }
    const aliases = assignRowAliasMetadata(pathRows);
    for (const row of tail) {
      const parsed = agentMessageRowToLlm(row);
      if (parsed) {
        const metadata = aliases.get(row);
        messages.push(metadata && (parsed.role === 'user' || parsed.role === 'assistant') ? { ...parsed, ...metadata } : parsed);
        anchors.push(row.id);
      }
      if (row.id != null) {
        const branchSummary = branchMap.get(row.id);
        if (branchSummary) {
          messages.push(branchSummaryAsUserMessage(branchSummary.summary, branchSummary.created_at));
          anchors.push(row.id);
        }
      }
    }
    this.checkpoints.register(sessionId, contextRevision(pathRows, summaryList), messages, anchors);
    return createContext('', messages);
  }

  async appendMessages(
    sessionId: string,
    newMessages: AgentMessage[],
    options?: AppendMessagesOptions,
  ): Promise<void> {
    if (newMessages.length === 0) return;
    await this.writeLock.run(sessionId, async () => {
      const list = this.messages.get(sessionId) ?? [];
      const session = await this.sessionStore.getBySessionId(sessionId);
      let parentId = session?.active_leaf_message_id ?? buildActivePathRows(list).at(-1)?.id ?? null;
      let seq = list.reduce((max, r) => Math.max(max, r.id ?? 0), 0);
      let lastId: number | undefined;

      for (let i = 0; i < newMessages.length; i += 1) {
        const message = newMessages[i]!;
        const row = serializeAgentMessage(message, options?.messageExtras?.[i]);
        row.session_id = sessionId;
        row.id = ++seq;
        row.parent_id = parentId;
        parentId = row.id;
        lastId = row.id;
        list.push(row);
      }
      this.messages.set(sessionId, list);
      if (lastId != null) {
        await this.sessionStore.setActiveLeafMessageId(sessionId, lastId);
      }
      await this.sessionStore.touch(sessionId);
    });
  }

  async archiveSession(sessionKey: string): Promise<boolean> {
    return this.sessionStore.archiveByKey(sessionKey);
  }

  async saveSummary(
    sessionId: string,
    summary: string,
    anchorOrOptions?: number | SaveSummaryOptions,
  ): Promise<void> {
    const text = summary.trim();
    if (!text) return;
    const opts = resolveSaveSummaryOptions(anchorOrOptions);
    await this.writeLock.run(sessionId, async () => {
      this.insertSummary(sessionId, text, opts);
    });
  }

  async saveCompactionSummary(sessionId: string, summary: string, prefix: readonly AgentMessage[], signal?: AbortSignal): Promise<boolean> {
    return this.writeLock.run(sessionId, async () => {
      if (signal?.aborted || !summary.trim()) return false;
      const session = await this.sessionStore.getBySessionId(sessionId);
      const path = buildActivePathRows(this.messages.get(sessionId) ?? [], session?.active_leaf_message_id);
      const summaries = this.summaries.get(sessionId) ?? [];
      const anchor = this.checkpoints.resolve(sessionId, contextRevision(path, summaries), prefix);
      if (signal?.aborted || anchor == null || !path.some(row => row.id === anchor)) return false;
      this.insertSummary(sessionId, summary.trim(), { anchorMessageId: anchor });
      return true;
    });
  }

  private insertSummary(sessionId: string, text: string, opts: SaveSummaryOptions): void {
    const list = this.summaries.get(sessionId) ?? [];
    list.push({
      id: list.length + 1,
      session_id: sessionId,
      summary: text,
      anchor_message_id: opts.anchorMessageId ?? null,
      branch_anchor_message_id: opts.branchAnchorMessageId ?? null,
      created_at: Date.now(),
    });
    this.summaries.set(sessionId, list);
  }

  async hasBranchSummary(sessionId: string, branchAnchorMessageId: number): Promise<boolean> {
    const list = this.summaries.get(sessionId) ?? [];
    return list.some(
      r => r.branch_anchor_message_id === branchAnchorMessageId && r.summary.trim().length > 0,
    );
  }

  async listBranchPoints(sessionId: string): Promise<SessionBranchPoint[]> {
    const allRows = [...(this.messages.get(sessionId) ?? [])];
    allRows.sort((a, b) => a.timestamp - b.timestamp || (a.id ?? 0) - (b.id ?? 0));
    const session = await this.sessionStore.getBySessionId(sessionId);
    return listUserBranchPoints(sortRowsChronologically(allRows), session?.active_leaf_message_id);
  }

  async setActiveLeaf(sessionId: string, messageId: number): Promise<boolean> {
    const allRows = this.messages.get(sessionId) ?? [];
    if (!allRows.some(r => r.id === messageId)) return false;
    await this.writeLock.run(sessionId, async () => {
      await this.sessionStore.setActiveLeafMessageId(sessionId, messageId);
    });
    return true;
  }

  async jumpToBranchIndex(sessionId: string, index: number): Promise<SessionBranchJumpResult> {
    const points = await this.listBranchPoints(sessionId);
    const point = points.find(p => p.index === index);
    if (!point) {
      return { ok: false, code: 'not_found', message: `未找到分支点 #${index}` };
    }
    const ok = await this.setActiveLeaf(sessionId, point.messageId);
    return ok
      ? { ok: true, code: 'switched', preview: point.preview, message: `已跳转到分支点 #${index}：${point.preview}` }
      : { ok: false, code: 'failed', message: '跳转失败' };
  }

  async resolveCompactionAnchorId(
    sessionId: string,
    keepRecentTokens: number,
    minKeepCount = 2,
  ): Promise<number | undefined> {
    const session = await this.sessionStore.getBySessionId(sessionId);
    const rows = buildActivePathRows(
      [...(this.messages.get(sessionId) ?? [])].sort(
        (a, b) => a.timestamp - b.timestamp || (a.id ?? 0) - (b.id ?? 0),
      ),
      session?.active_leaf_message_id,
    );
    const messages: AgentMessage[] = [];
    for (const row of rows) {
      const parsed = agentMessageRowToLlm(row);
      if (parsed) messages.push(parsed);
    }
    const startIdx = findKeepRecentStartIndex(messages, keepRecentTokens, minKeepCount);
    if (startIdx === 0) return undefined;
    const anchorRow = rows[startIdx - 1];
    return anchorRow?.id;
  }

  async getDeferredToolSnapshot(sessionId: string): Promise<DeferredToolSessionSnapshot> {
    return this.deferredToolSnapshots.get(sessionId) ?? { ...EMPTY_DEFERRED_TOOL_SNAPSHOT };
  }

  async setDeferredToolSnapshot(sessionId: string, snapshot: DeferredToolSessionSnapshot): Promise<void> {
    this.deferredToolSnapshots.set(sessionId, snapshot);
  }
}

export function createMemoryContextRepository(
  config?: ContextRepositoryConfig,
): { repository: MemoryContextRepository; sessionStore: MemoryAgentSessionStore } {
  const sessionStore = new MemoryAgentSessionStore();
  return {
    sessionStore,
    repository: new MemoryContextRepository(sessionStore, config),
  };
}
