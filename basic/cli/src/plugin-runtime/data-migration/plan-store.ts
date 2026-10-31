import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DataMigrationError, type DataMigrationPlan, type DataMigrationReceipt, type DataMigrationInspection, type PluginId } from '@zhin.js/plugin-runtime';

/** Durable Host intent; an interrupted mutation is never evidence of a confirmed commit. */
export type DataMigrationPlanPhase = 'prepared' | 'applying' | 'applied' | 'commit_unknown'
  | 'resuming' | 'resumed' | 'resume_unknown' | 'restoring' | 'restored' | 'inspection_required';
export interface StoredDataMigrationPlan {
  readonly version: 1;
  readonly owner: PluginId;
  readonly providerTitle: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly phase: DataMigrationPlanPhase;
  readonly intent?: 'apply' | 'restore';
  readonly plan: DataMigrationPlan;
  readonly receipt?: DataMigrationReceipt;
  readonly inspection?: DataMigrationInspection;
}
/** A trusted Host directory, never a path accepted from an HTTP request. */
export interface DataMigrationPlanStoreOptions { readonly directory: string }

/** Full before-images live in private files, outside the bounded plugin state store. */
export class DataMigrationPlanStore {
  readonly #directory: string;
  readonly #pending = new Map<string, Promise<unknown>>();
  constructor(options: DataMigrationPlanStoreOptions) { this.#directory = path.resolve(options.directory); }

  /** Serializes the complete read / provider call / persistence operation for one plan. */
  async exclusive<T>(planId: string, operation: () => Promise<T>): Promise<T> {
    this.#file(planId);
    const previous = this.#pending.get(planId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.#pending.set(planId, current);
    try { return await current; }
    finally { if (this.#pending.get(planId) === current) this.#pending.delete(planId); }
  }

  async read(planId: string): Promise<StoredDataMigrationPlan | undefined> {
    let file;
    try { file = await open(this.#file(planId), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if (isMissing(error)) return undefined; throw error; }
    try {
      if (!(await file.stat()).isFile()) throw new DataMigrationError('unavailable', 'Migration plan is not a regular file');
      const stored = JSON.parse(await file.readFile('utf8')) as StoredDataMigrationPlan;
      if (stored.version !== 1 || stored.plan?.id !== planId || typeof stored.owner !== 'string'
        || !PHASES.has(stored.phase)) throw new DataMigrationError('unavailable', 'Migration plan file is invalid');
      return stored;
    } finally { await file.close(); }
  }

  /** Atomic replacement plus fsync makes intent durable before the domain may mutate. */
  async write(stored: StoredDataMigrationPlan): Promise<void> {
    const destination = this.#file(stored.plan.id);
    const serialized = JSON.stringify(stored);
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await chmod(this.#directory, 0o700);
    const temporary = path.join(this.#directory, `.${stored.plan.id}.${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(serialized, 'utf8'); await file.sync();
    } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    finally { await file.close(); }
    try {
      await rename(temporary, destination);
      const directory = await open(this.#directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temporary).catch(error => { if (!isMissing(error)) throw error; }); }
  }

  #file(planId: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(planId)) {
      throw new DataMigrationError('invalid_input', 'Migration plan ID must be a Host-generated UUID');
    }
    return path.join(this.#directory, `${planId}.json`);
  }
}
const PHASES = new Set<DataMigrationPlanPhase>(['prepared', 'applying', 'applied', 'commit_unknown',
  'resuming', 'resumed', 'resume_unknown', 'restoring', 'restored', 'inspection_required']);
function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
