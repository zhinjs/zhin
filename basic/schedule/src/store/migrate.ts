import type { ResolvedJob } from '../types.js';
import type { StoredJob } from './types.js';
import { getScatterState } from '../utils/scatter-state.js';

export const CURRENT_SCHEMA_VERSION = 2;

type LegacyScatterResolved = Extract<ResolvedJob, { kind: 'scatter' }> & {
  minGapMinutes?: number;
  quietHours?: Extract<ResolvedJob, { kind: 'scatter' }>['quietHours'];
  misfire?: Extract<ResolvedJob, { kind: 'scatter' }>['misfire'];
};

export function migrateStoredJob(job: StoredJob): StoredJob {
  const version = job.schemaVersion ?? 1;
  if (version >= CURRENT_SCHEMA_VERSION && job.resolved.kind !== 'scatter') {
    return { ...job, schemaVersion: CURRENT_SCHEMA_VERSION };
  }

  let migrated: StoredJob = {
    ...job,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  if (job.resolved.kind === 'scatter') {
    const resolved = job.resolved as LegacyScatterResolved;
    const scatter = getScatterState(job.payload);
    migrated = {
      ...migrated,
      resolved: {
        ...resolved,
        minGapMinutes: resolved.minGapMinutes ?? 0,
        quietHours: resolved.quietHours ?? [],
        misfire: resolved.misfire ?? 'fire',
      },
      payload: {
        ...(job.payload && typeof job.payload === 'object'
          ? (job.payload as Record<string, unknown>)
          : {}),
        scatter,
      },
    };
  }

  return migrated;
}

export async function migrateJobsFile(path: string): Promise<number> {
  const fs = await import('node:fs/promises');
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0;
    }
    throw err;
  }

  const parsed = JSON.parse(raw) as { jobs?: StoredJob[] };
  const jobs = parsed.jobs ?? [];
  let migratedCount = 0;
  const nextJobs = jobs.map((job) => {
    const migrated = migrateStoredJob(job);
    if ((job.schemaVersion ?? 1) < CURRENT_SCHEMA_VERSION) {
      migratedCount++;
    }
    return migrated;
  });

  if (migratedCount > 0) {
    await fs.writeFile(path, JSON.stringify({ jobs: nextJobs }, null, 2) + '\n', 'utf8');
  }

  return migratedCount;
}
