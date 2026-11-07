/**
 * Turn Checkpoint Store — Durable step-level checkpointing for multi-step Agent tool turns.
 *
 * When a multi-step tool turn is interrupted mid-flight (by HMR reload, `system:restart`,
 * network drop, or timeout) after completing one or more `(assistant[toolCall] -> toolResult[])`
 * rounds, `TurnCheckpointStore` preserves the longest completed tool-round prefix per session.
 *
 * On a subsequent retry of the same prompt or an explicit continuation (`"继续"` / `"continue"`),
 * the turn runner resumes from the last committed `toolResult` boundary without re-executing
 * already-completed tools.
 */

import type { AgentMessage, AssistantMessage } from '@zhin.js/ai';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';

export const AGENT_TURN_CHECKPOINT_TABLE = 'agent_turn_checkpoints';

/** Default TTL for an unconsumed turn checkpoint (30 minutes). */
export const DEFAULT_TURN_CHECKPOINT_TTL_MS = 30 * 60 * 1000;

export const AGENT_TURN_CHECKPOINT_MODEL = {
  session_id: { type: 'text', nullable: false },
  prompt_text: { type: 'text', default: '' },
  messages_json: { type: 'text', nullable: false },
  iterations: { type: 'integer', default: 0 },
  updated_at: { type: 'integer', nullable: false },
} as const;

export interface TurnCheckpointRecord {
  readonly sessionId: string;
  readonly promptText: string;
  readonly messages: readonly AgentMessage[];
  readonly iterations: number;
  readonly updatedAt: number;
}

export interface TurnCheckpointStorage {
  read(sessionId: string): Promise<TurnCheckpointRecord | undefined>;
  write(record: TurnCheckpointRecord): Promise<void>;
  delete(sessionId: string): Promise<void>;
  prune(cutoffMs: number): Promise<void>;
}

/**
 * Extract the longest prefix of `messages` that starts with at least one `user` message
 * and ends at a complete `(assistant[toolCall+] -> matching toolResult+)` round.
 *
 * Returns an empty array if no completed tool round is present.
 */
export function extractCompletedToolRoundMessages(
  messages: readonly AgentMessage[],
): readonly AgentMessage[] {
  if (messages.length === 0) return [];

  let cursor = 0;
  while (cursor < messages.length && messages[cursor]?.role === 'user') {
    cursor += 1;
  }
  // Must begin with at least one user message.
  if (cursor === 0) return [];

  let lastValidEnd = 0;

  while (cursor < messages.length) {
    const current = messages[cursor];
    if (!current) break;

    if (current.role === 'user') {
      cursor += 1;
      continue;
    }

    if (current.role !== 'assistant') {
      break;
    }

    const assistant = current as AssistantMessage;
    if (!Array.isArray(assistant.content)) break;

    const toolCallIds = assistant.content
      .filter((block): block is Extract<typeof block, { type: 'toolCall' }> => block.type === 'toolCall')
      .map((block) => block.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    // A pure text assistant turn without tool calls is a terminal answer, not an intermediate tool step.
    if (toolCallIds.length === 0) {
      break;
    }

    const matchedIds = new Set<string>();
    let scan = cursor + 1;
    while (scan < messages.length) {
      const next = messages[scan];
      if (!next || next.role === 'user' || next.role === 'assistant') break;
      if (next.role === 'toolResult' && typeof next.toolCallId === 'string') {
        if (toolCallIds.includes(next.toolCallId)) {
          matchedIds.add(next.toolCallId);
        }
      }
      scan += 1;
    }

    const allResolved = toolCallIds.every((id) => matchedIds.has(id));
    if (!allResolved) {
      break;
    }

    lastValidEnd = scan;
    cursor = scan;
  }

  return lastValidEnd > 0 ? messages.slice(0, lastValidEnd) : [];
}

const EXPLICIT_CONTINUE_PATTERN =
  /^(继续|接着|接着说|接着做|继续执行|继续完成|刚才的继续|continue|resume|go on|keep going)$/iu;

function normalizePromptForComparison(text: string | undefined): string {
  return (text ?? '').trim().replace(/\s+/gu, ' ');
}

/**
 * Determine whether an incoming user prompt should resume a saved checkpoint
 * (either because it retries the same prompt or is an explicit continuation command).
 */
export function isCheckpointResumePrompt(
  rawContent: string | undefined,
  checkpointPrompt: string,
): { readonly resume: boolean; readonly isExplicitContinue: boolean } {
  const normalizedIncoming = normalizePromptForComparison(rawContent);
  if (!normalizedIncoming) {
    return { resume: false, isExplicitContinue: false };
  }
  if (EXPLICIT_CONTINUE_PATTERN.test(normalizedIncoming)) {
    return { resume: true, isExplicitContinue: true };
  }
  const normalizedSaved = normalizePromptForComparison(checkpointPrompt);
  if (normalizedSaved.length > 0 && normalizedIncoming === normalizedSaved) {
    return { resume: true, isExplicitContinue: false };
  }
  return { resume: false, isExplicitContinue: false };
}

export class DatabaseTurnCheckpointStorage implements TurnCheckpointStorage {
  constructor(
    private readonly database: Pick<DatabaseHost, 'models'>,
    private readonly tableName: string = AGENT_TURN_CHECKPOINT_TABLE,
  ) {}

  private get model(): any {
    const model = this.database.models.get(this.tableName);
    if (!model) {
      throw new Error(`Database table '${this.tableName}' is not ready`);
    }
    return model;
  }

  async read(sessionId: string): Promise<TurnCheckpointRecord | undefined> {
    const rows = (await this.model
      .select('session_id', 'prompt_text', 'messages_json', 'iterations', 'updated_at')
      .where({ session_id: sessionId })) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const latest = rows.reduce((best, row) =>
      Number(row.updated_at ?? 0) >= Number(best.updated_at ?? 0) ? row : best);
    try {
      const parsed = typeof latest.messages_json === 'string'
        ? JSON.parse(latest.messages_json)
        : latest.messages_json;
      if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
      return {
        sessionId: String(latest.session_id ?? sessionId),
        promptText: String(latest.prompt_text ?? ''),
        messages: parsed as AgentMessage[],
        iterations: Number(latest.iterations ?? 0),
        updatedAt: Number(latest.updated_at ?? Date.now()),
      };
    } catch {
      return undefined;
    }
  }

  async write(record: TurnCheckpointRecord): Promise<void> {
    await this.model.delete().where({ session_id: record.sessionId });
    await this.model.create({
      session_id: record.sessionId,
      prompt_text: record.promptText,
      messages_json: JSON.stringify(record.messages),
      iterations: record.iterations,
      updated_at: record.updatedAt,
    });
  }

  async delete(sessionId: string): Promise<void> {
    await this.model.delete().where({ session_id: sessionId });
  }

  async prune(cutoffMs: number): Promise<void> {
    await this.model.delete().where({ updated_at: { $lt: cutoffMs } });
  }
}

export interface TurnCheckpointStoreOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
}

export class TurnCheckpointStore {
  private readonly memory = new Map<string, TurnCheckpointRecord>();
  private storage?: TurnCheckpointStorage;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: TurnCheckpointStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TURN_CHECKPOINT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  activateDatabase(storage: TurnCheckpointStorage): void {
    this.storage = storage;
  }

  get persistent(): boolean {
    return this.storage !== undefined;
  }

  private isExpired(record: TurnCheckpointRecord): boolean {
    return this.now() - record.updatedAt > this.ttlMs;
  }

  async save(record: TurnCheckpointRecord): Promise<void> {
    if (record.messages.length === 0) return;
    const normalized: TurnCheckpointRecord = {
      sessionId: record.sessionId,
      promptText: record.promptText,
      messages: [...record.messages],
      iterations: record.iterations,
      updatedAt: record.updatedAt,
    };
    this.memory.set(record.sessionId, normalized);
    if (this.storage) {
      try {
        await this.storage.write(normalized);
      } catch {
        // Non-fatal: in-memory checkpoint remains available for same-process resume.
      }
    }
  }

  async peek(sessionId: string): Promise<TurnCheckpointRecord | undefined> {
    let record = this.memory.get(sessionId);
    if (!record && this.storage) {
      try {
        record = await this.storage.read(sessionId);
        if (record) this.memory.set(sessionId, record);
      } catch {
        record = undefined;
      }
    }
    if (!record) return undefined;
    if (this.isExpired(record)) {
      await this.clear(sessionId);
      return undefined;
    }
    return record;
  }

  async consume(sessionId: string): Promise<TurnCheckpointRecord | undefined> {
    const record = await this.peek(sessionId);
    if (!record) return undefined;
    await this.clear(sessionId);
    return record;
  }

  async clear(sessionId: string): Promise<void> {
    this.memory.delete(sessionId);
    if (this.storage) {
      try {
        await this.storage.delete(sessionId);
      } catch {
        // Ignore storage delete errors during cleanup.
      }
    }
  }

  async prune(nowMs: number = this.now()): Promise<void> {
    const cutoff = nowMs - this.ttlMs;
    for (const [sessionId, record] of this.memory.entries()) {
      if (record.updatedAt < cutoff) {
        this.memory.delete(sessionId);
      }
    }
    if (this.storage) {
      try {
        await this.storage.prune(cutoff);
      } catch {
        // Ignore storage prune errors.
      }
    }
  }
}
