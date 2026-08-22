import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import { DurableFileStore } from './durable-file-store.js';
import type {
  WorkroomEffectBlockerControlPort,
  WorkroomEffectBlockerInput,
} from '../plugin-runtime/workroom-effect-runtime.js';

export interface WorkroomEffectBlockerRecord {
  readonly version: 1;
  readonly projectId: string;
  readonly effectId: string;
  readonly revision: number;
  readonly previousDigest?: string;
  readonly status: 'blocked' | 'resolved';
  readonly owner: WorkroomEffectBlockerInput['owner'];
  readonly policy: WorkroomEffectBlockerInput['policy'];
  readonly reason: string;
  readonly deadline: number;
  readonly allowedSuccessors: WorkroomEffectBlockerInput['allowedSuccessors'];
  readonly resolvedAt?: number;
  readonly digest: string;
}

export interface WorkroomEffectBlockerRepository {
  read(projectId: string, effectId: string): Promise<WorkroomEffectBlockerRecord | undefined>;
  append(
    input: Omit<WorkroomEffectBlockerRecord, 'version' | 'revision' | 'previousDigest' | 'digest'>,
    expectedDigest?: string,
  ): Promise<WorkroomEffectBlockerRecord>;
}

export class FileWorkroomEffectBlockerRepository implements WorkroomEffectBlockerRepository {
  readonly #store: DurableFileStore;

  constructor(readonly directory: string) {
    this.#store = new DurableFileStore(directory);
  }

  async read(projectId: string, effectId: string): Promise<WorkroomEffectBlockerRecord | undefined> {
    const prefix = filePrefix(projectId, effectId);
    let names: readonly string[];
    try {
      names = (await readdir(this.directory)).filter(name => name.startsWith(prefix)).sort();
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return undefined;
      throw error;
    }
    let prior: WorkroomEffectBlockerRecord | undefined;
    for (const [index, name] of names.entries()) {
      if (name !== fileName(projectId, effectId, index + 1)) {
        throw new Error('Effect blocker repository sequence gap');
      }
      const current = parseRecord(await readFile(join(this.directory, name), 'utf8'));
      if (current.projectId !== projectId || current.effectId !== effectId
        || current.revision !== index + 1 || current.previousDigest !== prior?.digest) {
        throw new Error('Effect blocker repository chain drift');
      }
      prior = current;
    }
    if (prior) await this.#store.syncLeaf();
    return prior;
  }

  async append(
    input: Omit<WorkroomEffectBlockerRecord, 'version' | 'revision' | 'previousDigest' | 'digest'>,
    expectedDigest?: string,
  ): Promise<WorkroomEffectBlockerRecord> {
    const current = await this.read(input.projectId, input.effectId);
    if (current?.digest !== expectedDigest) throw new Error('Effect blocker repository CAS conflict');
    const body = deepFreeze({
      version: 1 as const,
      projectId: required(input.projectId, 'projectId'),
      effectId: required(input.effectId, 'effectId'),
      revision: (current?.revision ?? 0) + 1,
      ...(current ? { previousDigest: current.digest } : {}),
      status: input.status,
      owner: input.owner,
      policy: deepFreeze(input.policy),
      reason: required(input.reason, 'reason'),
      deadline: positive(input.deadline, 'deadline'),
      allowedSuccessors: Object.freeze([...input.allowedSuccessors]),
      ...(input.resolvedAt === undefined ? {} : { resolvedAt: positive(input.resolvedAt, 'resolvedAt') }),
    });
    const record = deepFreeze<WorkroomEffectBlockerRecord>({ ...body, digest: digest(body) });
    validateRecord(record);
    await this.#store.ensureDurableLeaf('Effect blocker repository');
    const target = join(this.directory, fileName(input.projectId, input.effectId, record.revision));
    const result = await this.#store.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(record),
      createdValue: record,
      onConflict: async () => {
        const existing = parseRecord(await readFile(target, 'utf8'));
        if (canonicalWorkroomJson(existing) !== canonicalWorkroomJson(record)) {
          throw new Error('Effect blocker repository CAS conflict');
        }
        return existing;
      },
    });
    return result.value;
  }
}

export class DurableWorkroomEffectBlockerControl implements WorkroomEffectBlockerControlPort {
  constructor(
    readonly repository: WorkroomEffectBlockerRepository,
    readonly now: () => number = Date.now,
  ) {}

  async block(input: WorkroomEffectBlockerInput): Promise<void> {
    const current = await this.repository.read(input.projectId, input.effectId);
    if (current?.status === 'blocked' && current.deadline > this.now()
      && current.owner === input.owner && current.reason === input.reason
      && canonicalWorkroomJson(current.policy) === canonicalWorkroomJson(input.policy)
      && canonicalWorkroomJson(current.allowedSuccessors) === canonicalWorkroomJson(input.allowedSuccessors)) return;
    await this.repository.append({
      ...input,
      status: 'blocked',
    }, current?.digest);
  }

  async recover(projectId: string, effectId: string): Promise<void> {
    const current = await this.repository.read(projectId, effectId);
    if (!current || current.status === 'resolved') return;
    await this.repository.append({
      projectId,
      effectId,
      status: 'resolved',
      owner: current.owner,
      policy: current.policy,
      reason: current.reason,
      deadline: current.deadline,
      allowedSuccessors: current.allowedSuccessors,
      resolvedAt: this.now(),
    }, current.digest);
  }
}

function parseRecord(serialized: string): WorkroomEffectBlockerRecord {
  const value = JSON.parse(serialized) as WorkroomEffectBlockerRecord;
  validateRecord(value);
  const { digest: ignored, ...body } = value;
  void ignored;
  if (value.digest !== digest(body) || canonicalWorkroomJson(value) !== canonicalWorkroomJson({ ...body, digest: digest(body) })) {
    throw new Error('Effect blocker record digest drift');
  }
  return deepFreeze(value);
}

function validateRecord(value: WorkroomEffectBlockerRecord): void {
  if (value.version !== 1 || !['blocked', 'resolved'].includes(value.status)) {
    throw new Error('Effect blocker record is invalid');
  }
  required(value.projectId, 'projectId');
  required(value.effectId, 'effectId');
  positive(value.revision, 'revision');
  if (value.previousDigest !== undefined) requiredDigest(value.previousDigest, 'previousDigest');
  required(value.owner, 'owner');
  if (!['pinned_profile', 'root_emergency_fallback'].includes(value.policy?.kind)) {
    throw new Error('Effect blocker policy kind is invalid');
  }
  required(value.policy?.ref, 'blocker policy ref');
  requiredDigest(value.policy?.digest, 'blocker policy digest');
  required(value.reason, 'reason');
  positive(value.deadline, 'deadline');
  if (!Array.isArray(value.allowedSuccessors) || value.allowedSuccessors.length === 0
    || value.allowedSuccessors.some(item => !['retry', 'reconcile', 'cancel'].includes(item))) {
    throw new Error('Effect blocker allowed successors are invalid');
  }
  if (value.status === 'resolved' && value.resolvedAt === undefined) {
    throw new Error('Resolved Effect blocker requires resolvedAt');
  }
  requiredDigest(value.digest, 'digest');
}

function filePrefix(projectId: string, effectId: string): string {
  return `effect-blocker-${createHash('sha256').update(`${projectId}\0${effectId}`).digest('hex')}-`;
}
function fileName(projectId: string, effectId: string, revision: number): string {
  return `${filePrefix(projectId, effectId)}${String(revision).padStart(12, '0')}.json`;
}
function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}
function requiredDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} is invalid`);
  return value;
}
function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid`);
  return Number(value);
}
function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
