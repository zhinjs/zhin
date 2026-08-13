import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolExecutionContext,
} from '@zhin.js/tool';

export type TodoStatus = 'pending' | 'in-progress' | 'done';

export interface TodoItem {
  readonly title: string;
  readonly detail?: string;
  readonly status: TodoStatus;
}

interface TodoDocument {
  readonly sessionKey: string;
  readonly updatedAt: string;
  readonly items: readonly TodoItem[];
}

export interface TodoStore {
  read(sessionKey: string, signal: AbortSignal): Promise<readonly TodoItem[]>;
  replace(sessionKey: string, items: readonly TodoItem[], signal: AbortSignal): Promise<void>;
}

export interface NativeTodoToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

/** Crash-safe, session-addressed task-plan store. Callers never provide filesystem paths. */
export class FileTodoStore implements TodoStore {
  readonly #tails = new Map<string, Promise<void>>();

  constructor(private readonly root: string) {}

  async read(sessionKey: string, signal: AbortSignal): Promise<readonly TodoItem[]> {
    signal.throwIfAborted();
    await this.#tails.get(sessionKey);
    try {
      const raw = await fs.readFile(this.#file(sessionKey), { encoding: 'utf8', signal });
      const document = parseDocument(raw, sessionKey);
      return Object.freeze(document.items.map((item) => Object.freeze({ ...item })));
    } catch (error) {
      if (isNotFound(error)) return Object.freeze([]);
      throw error;
    }
  }

  replace(sessionKey: string, items: readonly TodoItem[], signal: AbortSignal): Promise<void> {
    const previous = this.#tails.get(sessionKey) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      signal.throwIfAborted();
      await fs.mkdir(this.root, { recursive: true });
      const target = this.#file(sessionKey);
      const temporary = `${target}.${randomUUID()}.tmp`;
      const document: TodoDocument = Object.freeze({
        sessionKey,
        updatedAt: new Date().toISOString(),
        items: Object.freeze(items.map((item) => Object.freeze({ ...item }))),
      });
      try {
        await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
          encoding: 'utf8', signal, mode: 0o600,
        });
        signal.throwIfAborted();
        await fs.rename(temporary, target);
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    });
    const settled = operation.finally(() => {
      if (this.#tails.get(sessionKey) === settled) this.#tails.delete(sessionKey);
    });
    this.#tails.set(sessionKey, settled);
    return settled;
  }

  #file(sessionKey: string): string {
    const digest = createHash('sha256').update(sessionKey).digest('hex');
    return path.join(this.root, `${digest}.json`);
  }
}

export function createNativeTodoToolFeatures(store: TodoStore): readonly NativeTodoToolFeature[] {
  return Object.freeze([
    feature('todo_read', defineAgentTool({
      description: 'Read the task plan owned by the current canonical session.',
      inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}), required: Object.freeze([]) }),
      approval: 'never',
      execute: async (_input, context) => formatTodos(await store.read(context.sessionKey, context.signal)),
    })),
    feature('todo_write', defineAgentTool({
      description: 'Atomically replace the task plan owned by the current canonical session.',
      inputSchema: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          items: Object.freeze({
            type: 'array',
            maxItems: 100,
            items: Object.freeze({
              type: 'object',
              properties: Object.freeze({
                title: Object.freeze({ type: 'string' }),
                detail: Object.freeze({ type: 'string' }),
                status: Object.freeze({ type: 'string', enum: Object.freeze(['pending', 'in-progress', 'done']) }),
              }),
              required: Object.freeze(['title', 'status']),
            }),
          }),
        }),
        required: Object.freeze(['items']),
      }),
      approval: 'never',
      execute: async (input, context) => writeTodos(input, context, store),
    })),
  ]);
}

async function writeTodos(
  input: Record<string, unknown>,
  context: ToolExecutionContext,
  store: TodoStore,
): Promise<string> {
  const items = parseItems(input.items);
  await store.replace(context.sessionKey, items, context.signal);
  const done = items.filter((item) => item.status === 'done').length;
  return `Tasks updated (${done}/${items.length} done)`;
}

function parseItems(value: unknown): readonly TodoItem[] {
  if (!Array.isArray(value)) throw new TypeError('items must be an array');
  if (value.length > 100) throw new TypeError('items cannot contain more than 100 tasks');
  return Object.freeze(value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new TypeError(`items[${index}] must be an object`);
    const item = raw as Record<string, unknown>;
    const title = boundedText(item.title, `items[${index}].title`, 500, false);
    const detail = item.detail === undefined ? undefined : boundedText(item.detail, `items[${index}].detail`, 4_000, true);
    if (item.status !== 'pending' && item.status !== 'in-progress' && item.status !== 'done') {
      throw new TypeError(`items[${index}].status is invalid`);
    }
    return Object.freeze({ title, ...(detail !== undefined ? { detail } : {}), status: item.status });
  }));
}

function parseDocument(raw: string, expectedSessionKey: string): TodoDocument {
  const value = JSON.parse(raw) as Partial<TodoDocument>;
  if (value.sessionKey !== expectedSessionKey) throw new Error('TODO document session identity mismatch');
  return Object.freeze({
    sessionKey: expectedSessionKey,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    items: parseItems(value.items),
  });
}

function formatTodos(items: readonly TodoItem[]): string {
  if (items.length === 0) return 'No tasks found. Use todo_write to create a plan.';
  const done = items.filter((item) => item.status === 'done').length;
  const lines = items.map((item, index) => {
    const status = item.status === 'done' ? '✅' : item.status === 'in-progress' ? '🔄' : '⬜';
    return `${status} ${index + 1}. ${item.title}${item.detail ? ` — ${item.detail}` : ''}`;
  });
  return `Tasks (${done}/${items.length} done):\n${lines.join('\n')}`;
}

function boundedText(value: unknown, name: string, maximum: number, allowEmpty: boolean): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new TypeError(`${name} is required`);
  if (value.length > maximum) throw new TypeError(`${name} exceeds ${maximum} characters`);
  return value;
}

function feature(
  name: string,
  definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>,
): NativeTodoToolFeature {
  return Object.freeze({ feature: toolFeatureId, name, definition });
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
