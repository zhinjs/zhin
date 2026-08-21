import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  WorkroomEffectSequenceConflictError,
  assertWorkroomEffectEvent,
  createWorkroomEffectEvent,
  replayWorkroomEffectLedger,
  type WorkroomEffectEvent,
  type WorkroomEffectEventDraft,
  type WorkroomEffectJournal,
} from './effect-ledger.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import { DurableFileStore } from './durable-file-store.js';

interface EffectSegment {
  readonly version: 1;
  readonly projectId: string;
  readonly expectedSequence: number;
  readonly event: WorkroomEffectEvent;
  readonly payloadDigest: string;
}

/** Crash-durable append-only Effect Ledger; one create-only slot owns each sequence. */
export class FileWorkroomEffectJournal implements WorkroomEffectJournal {
  readonly #store: DurableFileStore;

  constructor(readonly directory: string) {
    this.#store = new DurableFileStore(directory);
  }

  async read(projectId: string): Promise<readonly WorkroomEffectEvent[]> {
    const id = required(projectId, 'projectId');
    const prefix = segmentPrefix(id);
    let names: readonly string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return Object.freeze([]);
      throw error;
    }
    const candidates = names.filter(name => name.startsWith(prefix)).sort();
    if (candidates.some(name => !segmentPattern(prefix).test(name))) {
      throw new Error('Invalid Workroom Effect Journal segment name');
    }
    const events = await Promise.all(candidates.map(async (name, index) =>
      parseSegment(await readFile(join(this.directory, name), 'utf8'), id, index).event));
    replayWorkroomEffectLedger(id, events);
    if (events.length > 0) await this.#store.syncLeaf();
    return deepFreeze(events);
  }

  async append(
    projectId: string,
    expectedSequence: number,
    drafts: readonly WorkroomEffectEventDraft[],
  ): Promise<readonly WorkroomEffectEvent[]> {
    const id = required(projectId, 'projectId');
    if (!Number.isSafeInteger(expectedSequence) || expectedSequence < -1) {
      throw new Error('Workroom Effect expectedSequence is invalid');
    }
    if (!Array.isArray(drafts) || drafts.length === 0) {
      throw new Error('Workroom Effect append requires events');
    }
    if (drafts.length !== 1) {
      throw new Error('File Workroom Effect Journal requires one atomic event per append');
    }
    const current = await this.read(id);
    const actual = current.length - 1;
    if (actual !== expectedSequence) throw new WorkroomEffectSequenceConflictError(expectedSequence, actual);
    const appended = drafts.map((draft, index) => createWorkroomEffectEvent(
      id,
      expectedSequence + index + 1,
      draft,
    ));
    replayWorkroomEffectLedger(id, Object.freeze([...current, ...appended]));
    await this.#store.ensureDurableLeaf('Workroom Effect Journal');
    for (const event of appended) {
      const body = deepFreeze({
        version: 1 as const,
        projectId: id,
        expectedSequence: event.sequence - 1,
        event,
      });
      const segment = deepFreeze<EffectSegment>({ ...body, payloadDigest: digest(body) });
      const target = join(this.directory, segmentName(id, event.sequence));
      await this.#store.publishCreateOnly({
        target,
        content: canonicalWorkroomJson(segment),
        createdValue: segment,
        onConflict: async () => {
          const existing = parseSegment(await readFile(target, 'utf8'), id, event.sequence);
          if (canonicalWorkroomJson(existing) !== canonicalWorkroomJson(segment)) {
            throw new WorkroomEffectSequenceConflictError(event.sequence - 1, event.sequence);
          }
          return existing;
        },
      });
    }
    return deepFreeze(appended);
  }
}

function parseSegment(serialized: string, projectId: string, sequence: number): EffectSegment {
  const value = JSON.parse(serialized) as EffectSegment;
  if (value.version !== 1 || value.projectId !== projectId
    || value.expectedSequence !== sequence - 1 || value.event?.sequence !== sequence) {
    throw new Error('Invalid Workroom Effect Journal segment binding');
  }
  assertWorkroomEffectEvent(value.event, projectId, sequence);
  const body = deepFreeze({
    version: 1 as const,
    projectId,
    expectedSequence: sequence - 1,
    event: value.event,
  });
  const canonical = deepFreeze({ ...body, payloadDigest: digest(body) });
  if (value.payloadDigest !== canonical.payloadDigest
    || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Invalid Workroom Effect Journal segment digest');
  }
  return canonical;
}

function segmentPrefix(projectId: string): string {
  return `effect-${createHash('sha256').update(projectId).digest('hex')}-`;
}

function segmentName(projectId: string, sequence: number): string {
  return `${segmentPrefix(projectId)}${String(sequence).padStart(16, '0')}.json`;
}

function segmentPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}[0-9]{16}\\.json$`, 'u');
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
