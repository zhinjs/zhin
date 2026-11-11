/**
 * In-memory A2A TaskStore with a hard size cap and TTL eviction of finished tasks.
 *
 * Mirrors the SDK `InMemoryTaskStore` (tenant → owner scoping, list filters and cursor
 * format), which has no way to drop entries and therefore grows for the process lifetime.
 */
import { TaskState, type ListTasksRequest, type ListTasksResponse, type Task } from '@a2a-js/sdk';
import {
  RequestMalformedError,
  resolveUserScope,
  type ServerCallContext,
  type TaskStore,
} from '@a2a-js/sdk/server';

export const DEFAULT_A2A_TASK_STORE_MAX_TASKS = 1_000;
export const DEFAULT_A2A_TASK_STORE_TERMINAL_TTL_MS = 60 * 60_000;
const DEFAULT_PAGE_SIZE = 50;

const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
]);

export interface BoundedTaskStoreOptions {
  /** Maximum number of stored tasks across all scopes. */
  readonly maxTasks?: number;
  /** How long a task in a terminal state stays readable. */
  readonly terminalTtlMs?: number;
  readonly now?: () => number;
}

interface Entry {
  readonly scope: string;
  readonly task: Task;
  readonly savedAt: number;
  readonly terminal: boolean;
}

export class BoundedTaskStore implements TaskStore {
  /** Insertion order is last-save order: a save re-inserts the entry at the end. */
  readonly #entries = new Map<string, Entry>();
  readonly #maxTasks: number;
  readonly #terminalTtlMs: number;
  readonly #now: () => number;

  constructor(options: BoundedTaskStoreOptions = {}) {
    this.#maxTasks = Math.max(1, options.maxTasks ?? DEFAULT_A2A_TASK_STORE_MAX_TASKS);
    this.#terminalTtlMs = Math.max(0, options.terminalTtlMs ?? DEFAULT_A2A_TASK_STORE_TERMINAL_TTL_MS);
    this.#now = options.now ?? Date.now;
  }

  get size(): number {
    return this.#entries.size;
  }

  async load(taskId: string, context: ServerCallContext): Promise<Task | undefined> {
    this.#evictExpired();
    const entry = this.#entries.get(entryKey(scopeOf(context), taskId));
    return entry ? structuredClone(entry.task) : undefined;
  }

  async save(task: Task, context: ServerCallContext): Promise<void> {
    const scope = scopeOf(context);
    const key = entryKey(scope, task.id);
    this.#entries.delete(key);
    this.#entries.set(key, {
      scope,
      task: structuredClone(task),
      savedAt: this.#now(),
      terminal: task.status !== undefined && TERMINAL_STATES.has(task.status.state),
    });
    this.#evictExpired();
    this.#evictOverflow();
  }

  async list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse> {
    this.#evictExpired();
    const {
      contextId,
      status,
      pageSize = DEFAULT_PAGE_SIZE,
      pageToken,
      statusTimestampAfter,
      includeArtifacts = false,
    } = params;
    const scope = scopeOf(context);
    let tasks: Task[] = [];
    for (const entry of this.#entries.values()) {
      if (entry.scope === scope) tasks.push(entry.task);
    }
    if (contextId) tasks = tasks.filter((task) => task.contextId === contextId);
    if (status !== undefined) tasks = tasks.filter((task) => task.status?.state === status);
    if (statusTimestampAfter) {
      const filterTime = new Date(statusTimestampAfter).getTime();
      tasks = tasks.filter(
        (task) => task.status?.timestamp && new Date(task.status.timestamp).getTime() > filterTime,
      );
    }
    tasks.sort((a, b) => {
      const timeA = a.status?.timestamp || '';
      const timeB = b.status?.timestamp || '';
      return timeB !== timeA ? timeB.localeCompare(timeA) : b.id.localeCompare(a.id);
    });
    const totalSize = tasks.length;
    if (pageToken) {
      const decoded = Buffer.from(pageToken, 'base64').toString('utf-8');
      const [cursorTimestamp, ...idParts] = decoded.split('|');
      if (idParts.length === 0) throw new RequestMalformedError('Invalid page token format.');
      const cursorId = idParts.join('|');
      const cursorIndex = tasks.findIndex(
        (task) => (task.status?.timestamp || '') === cursorTimestamp && task.id === cursorId,
      );
      tasks = cursorIndex === -1 ? [] : tasks.slice(cursorIndex + 1);
    }
    const page = tasks.slice(0, pageSize);
    let nextPageToken = '';
    const last = page[page.length - 1];
    if (last && tasks.length > page.length) {
      nextPageToken = Buffer.from(`${last.status?.timestamp || ''}|${last.id}`).toString('base64');
    }
    return {
      tasks: page.map((task) => {
        const copy = structuredClone(task);
        if (!includeArtifacts) copy.artifacts = [];
        return copy;
      }),
      nextPageToken,
      pageSize,
      totalSize,
    };
  }

  #evictExpired(): void {
    const deadline = this.#now() - this.#terminalTtlMs;
    for (const [key, entry] of this.#entries) {
      if (entry.terminal && entry.savedAt <= deadline) this.#entries.delete(key);
    }
  }

  #evictOverflow(): void {
    if (this.#entries.size <= this.#maxTasks) return;
    // Finished tasks go first; unfinished ones are only dropped to keep the hard cap.
    for (const terminalOnly of [true, false]) {
      for (const [key, entry] of this.#entries) {
        if (this.#entries.size <= this.#maxTasks) return;
        if (!terminalOnly || entry.terminal) this.#entries.delete(key);
      }
    }
  }
}

function scopeOf(context: ServerCallContext): string {
  return `${context.tenant ?? ''}\u0000${resolveUserScope(context)}`;
}

function entryKey(scope: string, taskId: string): string {
  return `${scope}\u0000${taskId}`;
}
