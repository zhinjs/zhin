import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DurableFileStore } from '../durable-file-store.js';
import { digestCanonicalWorkroomValue as digest } from '../canonical-value.js';
import type {
  WorkroomProjectionBinding,
  WorkroomProjectionCapture,
  WorkroomProjectionDeliveryResult,
  WorkroomProjectionOutboxItem,
  WorkroomProjectionRepository,
  WorkroomProjectionState,
} from './contracts.js';
import { WorkroomProjectionRevisionConflictError } from './contracts.js';
import {
  applyBinding,
  applyCapture,
  applyClaim,
  applySettlement,
  emptyProjectionState,
  hasCode,
  parseProjectionState,
  projectionSnapshotName,
} from './repository-state.js';

export class FileWorkroomProjectionRepository implements WorkroomProjectionRepository {
  readonly #store: DurableFileStore;

  constructor(directory: string) {
    this.#store = new DurableFileStore(directory);
  }

  async read(): Promise<WorkroomProjectionState> {
    let names: string[];
    try {
      names = (await readdir(this.#store.directory))
        .filter(name => /^projection\.[0-9]{16}\.json$/u.test(name))
        .sort();
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return emptyProjectionState();
      throw error;
    }
    if (names.length === 0) return emptyProjectionState();
    for (let index = 0; index < names.length; index += 1) {
      const expected = projectionSnapshotName(index + 1);
      if (names[index] !== expected) {
        throw new Error(`Workroom Projection snapshot gap before revision ${index + 1}`);
      }
    }
    const parsed = JSON.parse(await readFile(
      join(this.#store.directory, names.at(-1)!),
      'utf8',
    )) as unknown;
    return parseProjectionState(parsed, names.length);
  }

  async capture(
    expectedRevision: number,
    input: WorkroomProjectionCapture,
  ): Promise<WorkroomProjectionState> {
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      throw new WorkroomProjectionRevisionConflictError(expectedRevision, current.revision);
    }
    const next = applyCapture(current, input);
    return await this.#publish(expectedRevision, next);
  }

  async bind(
    expectedRevision: number,
    binding: WorkroomProjectionBinding,
  ): Promise<WorkroomProjectionState> {
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      throw new WorkroomProjectionRevisionConflictError(expectedRevision, current.revision);
    }
    const next = applyBinding(current, binding);
    if (next === current) return current;
    return await this.#publish(expectedRevision, next);
  }

  async claimNext(
    expectedRevision: number,
    workerId: string,
    now: number,
    leaseMs: number,
  ): Promise<WorkroomProjectionOutboxItem | undefined> {
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      throw new WorkroomProjectionRevisionConflictError(expectedRevision, current.revision);
    }
    const claimed = applyClaim(current, workerId, now, leaseMs);
    if (!claimed) return undefined;
    const persisted = await this.#publish(expectedRevision, claimed.state);
    return persisted.items[claimed.item.id];
  }

  async settle(
    expectedRevision: number,
    itemId: string,
    workerId: string,
    fence: number,
    result: WorkroomProjectionDeliveryResult,
    settledAt: number,
  ): Promise<WorkroomProjectionState> {
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      throw new WorkroomProjectionRevisionConflictError(expectedRevision, current.revision);
    }
    return await this.#publish(
      expectedRevision,
      applySettlement(current, itemId, workerId, fence, result, settledAt),
    );
  }

  async #publish(
    expectedRevision: number,
    next: WorkroomProjectionState,
  ): Promise<WorkroomProjectionState> {
    await this.#store.ensureDurableLeaf('Workroom Projection repository');
    const target = join(this.#store.directory, projectionSnapshotName(next.revision));
    const published = await this.#store.publishCreateOnly({
      target,
      content: JSON.stringify({ state: next, digest: digest(next) }),
      createdValue: next,
      onConflict: async () => {
        const winner = parseProjectionState(
          JSON.parse(await readFile(target, 'utf8')) as unknown,
          next.revision,
        );
        if (digest(winner) === digest(next)) return await this.read();
        const latest = await this.read();
        throw new WorkroomProjectionRevisionConflictError(expectedRevision, latest.revision);
      },
    });
    return published.value;
  }
}
