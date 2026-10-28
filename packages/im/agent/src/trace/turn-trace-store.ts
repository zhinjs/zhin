/**
 * Lightweight store of the most recent N TurnTraces in one JSON file
 * (`data/agent-traces/recent.json`). Written by the running bot, read by
 * `zhin trace`. Full persistence with retention is #728.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { TURN_TRACE_VERSION, type TurnTrace } from './turn-trace.js';

export const DEFAULT_TURN_TRACE_LIMIT = 50;

export interface TurnTraceStore {
  readonly maxBytes?: number;
  save(trace: TurnTrace): Promise<void>;
  /** Oldest first. */
  list(): Promise<readonly TurnTrace[]>;
  latest(): Promise<TurnTrace | undefined>;
  /** Exact turn id, or a unique prefix of one. */
  find(turnId: string): Promise<TurnTrace | undefined>;
}

interface TurnTraceFile {
  readonly version: typeof TURN_TRACE_VERSION;
  readonly traces: readonly TurnTrace[];
}

export function defaultTurnTraceFile(projectRoot: string): string {
  return join(projectRoot, 'data', 'agent-traces', 'recent.json');
}

export function createFileTurnTraceStore(
  file: string,
  options: Readonly<{ limit?: number }> = {},
): TurnTraceStore {
  const limit = Number.isInteger(options.limit) && Number(options.limit) > 0
    ? Number(options.limit)
    : DEFAULT_TURN_TRACE_LIMIT;
  let tail: Promise<void> = Promise.resolve();

  const read = async (): Promise<readonly TurnTrace[]> => {
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<TurnTraceFile>;
      return Array.isArray(parsed.traces) ? parsed.traces : [];
    } catch {
      // A torn or hand-edited file must not break the bot or the CLI.
      return [];
    }
  };

  const write = async (traces: readonly TurnTrace[]): Promise<void> => {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    const body: TurnTraceFile = { version: TURN_TRACE_VERSION, traces };
    await writeFile(temporary, `${JSON.stringify(body)}\n`, 'utf8');
    await rename(temporary, file);
  };

  return Object.freeze({
    save(trace: TurnTrace): Promise<void> {
      const operation = tail.then(async () => {
        const existing = (await read()).filter(item => item.turn_id !== trace.turn_id);
        await write([...existing, trace].slice(-limit));
      });
      tail = operation.catch(() => undefined);
      return operation;
    },
    list: read,
    async latest() {
      return (await read()).at(-1);
    },
    async find(turnId: string) {
      const traces = await read();
      const exact = traces.find(trace => trace.turn_id === turnId);
      if (exact) return exact;
      const matches = traces.filter(trace => trace.turn_id.startsWith(turnId));
      return matches.length === 1 ? matches[0] : undefined;
    },
  });
}
