import type { ResolvedJob } from '../types.js';

export interface StoredJob {
  schemaVersion?: number;
  id: string;
  resolved: ResolvedJob;
  handlerKey: string;
  payload?: unknown;
  nextRunAt: string | null;
  cancelled: boolean;
  updatedAt: string;
  paused?: boolean;
  runCount?: number;
  maxRuns?: number;
  expiresAt?: string | null;
}

export interface JobStore {
  load(): Promise<StoredJob[]>;
  upsert(job: StoredJob): Promise<void>;
  remove(id: string): Promise<void>;
  listDue(before: Date, limit?: number): Promise<StoredJob[]>;
  claim?(id: string, owner: string, ttlMs: number): Promise<boolean>;
  release?(id: string, owner: string): Promise<void>;
}

export interface LocalJsonStoreOptions {
  path?: string;
}

export const DEFAULT_JOBS_PATH = '.cn-calendar-schedule/jobs.json';
