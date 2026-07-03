/**
 * Assistant Profile 加载与 Bootstrap 合并（M5）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BootstrapFile, BootstrapFileName } from '../bootstrap.js';
import { BOOTSTRAP_FILENAMES, loadBootstrapFiles } from '../bootstrap.js';
import type { AssistantProfileConfig } from './profile-types.js';
import {
  ASSISTANT_PROFILE_VERSION,
  DEFAULT_HEARTBEAT_PROMPT,
  DEFAULT_PROFILE_FILENAME,
  PROFILE_HEARTBEAT_JOB_ID,
  PROFILE_MORNING_BRIEF_JOB_ID,
  PROFILE_BEDTIME_CHECK_JOB_ID,
  type AssistantProfile,
  type AssistantProfileRoutineCron,
  type AssistantProfileRoutineHeartbeat,
} from './profile-types.js';
import type { ScheduleJobStore } from './job-store.js';
import type { JobNotify, ScheduleJob } from './types.js';
import { parseJobNotify, resolveEffectiveNotify } from './notification-router.js';
import { buildJobScheduleFromCronInput } from '../schedule-cron.js';

function resolveProfileJobNotify(
  routineNotify: JobNotify | undefined,
  profileDefaults: JobNotify | undefined,
): JobNotify {
  const effective = resolveEffectiveNotify(routineNotify, profileDefaults);
  if (effective.channel === 'im') {
    return parseJobNotify(effective);
  }
  return effective;
}

function profileCronJobId(key: string): string {
  if (key === 'morningBrief') return PROFILE_MORNING_BRIEF_JOB_ID;
  if (key === 'bedtimeCheck') return PROFILE_BEDTIME_CHECK_JOB_ID;
  return `assistant-profile-${key}`;
}

function isCronRoutine(
  key: string,
  value: unknown,
): value is AssistantProfileRoutineCron {
  if (key === 'heartbeat' || !value || typeof value !== 'object') return false;
  const routine = value as AssistantProfileRoutineCron;
  return typeof routine.cron === 'string' && typeof routine.prompt === 'string';
}

export function resolveAssistantProfileConfig(
  raw?: AssistantProfileConfig,
): AssistantProfileConfig & { enabled: boolean; file: string } {
  return {
    enabled: raw?.enabled === true,
    file: raw?.file?.trim() || DEFAULT_PROFILE_FILENAME,
  };
}

export function resolveProfilePath(workspaceDir: string, file: string): string {
  return path.isAbsolute(file) ? file : path.join(workspaceDir, file);
}

export async function loadAssistantProfileFile(
  workspaceDir: string,
  profileCfg?: AssistantProfileConfig,
): Promise<AssistantProfile | null> {
  const resolved = resolveAssistantProfileConfig(profileCfg);
  if (!resolved.enabled) return null;

  const filePath = resolveProfilePath(workspaceDir, resolved.file);
  if (!fs.existsSync(filePath)) return null;

  let jsYaml: typeof import('js-yaml');
  try {
    jsYaml = await import('js-yaml');
  } catch {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = jsYaml.load(raw) as AssistantProfile | null;
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed;
}

function profileSectionForName(
  profile: AssistantProfile,
  name: BootstrapFileName,
): string | undefined {
  if (name === 'SOUL.md') return profile.persona?.soul?.trim();
  if (name === 'AGENTS.md') return profile.agents?.trim();
  if (name === 'TOOLS.md') return profile.tools?.trim();
  return undefined;
}

/**
 * Profile 优先，缺失字段回退 SOUL/AGENTS/TOOLS 文件。
 */
export async function loadBootstrapWithProfile(
  workspaceDir?: string,
  profileCfg?: AssistantProfileConfig,
): Promise<{ files: BootstrapFile[]; profile: AssistantProfile | null; profilePath?: string }> {
  const cwd = workspaceDir || process.cwd();
  const resolved = resolveAssistantProfileConfig(profileCfg);
  const profile = await loadAssistantProfileFile(cwd, profileCfg);
  const diskFiles = await loadBootstrapFiles(cwd);

  if (!profile) {
    return { files: diskFiles, profile: null };
  }

  const profilePath = resolveProfilePath(cwd, resolved.file);
  const merged: BootstrapFile[] = [];

  for (const name of BOOTSTRAP_FILENAMES) {
    const fromProfile = profileSectionForName(profile, name);
    if (fromProfile) {
      merged.push({
        name,
        path: `${profilePath}#${name}`,
        content: fromProfile,
        missing: false,
      });
      continue;
    }
    const disk = diskFiles.find((f) => f.name === name);
    if (disk) merged.push(disk);
  }

  return { files: merged, profile, profilePath };
}

export function buildScheduleJobFromRoutine(
  jobId: string,
  defaultLabel: string,
  routine: AssistantProfileRoutineCron,
  profileDefaults?: JobNotify,
): ScheduleJob {
  const built = buildJobScheduleFromCronInput(routine.scheduleKind, routine.cron, routine.tz);
  if ('error' in built) {
    throw new Error(`profile routine "${jobId}": ${built.error}`);
  }
  const now = Date.now();
  return {
    id: jobId,
    label: routine.label?.trim() || defaultLabel,
    enabled: routine.enabled !== false,
    schedule: built,
    action: { kind: 'agent', prompt: routine.prompt.trim() },
    notify: resolveProfileJobNotify(routine.notify, profileDefaults),
    createdAt: now,
    updatedAt: now,
    state: {},
    source: 'profile',
  };
}

/** @deprecated */
export const buildCronJobFromRoutine = buildScheduleJobFromRoutine;

export function buildHeartbeatJobFromRoutine(
  routine: AssistantProfileRoutineHeartbeat,
  profileDefaults?: JobNotify,
): ScheduleJob {
  const now = Date.now();
  return {
    id: PROFILE_HEARTBEAT_JOB_ID,
    label: 'Profile heartbeat',
    enabled: routine.enabled !== false,
    schedule: {
      kind: 'every',
      everyMs: routine.everyMs ?? 30 * 60 * 1000,
    },
    action: {
      kind: 'heartbeat',
      prompt: routine.prompt?.trim() || DEFAULT_HEARTBEAT_PROMPT,
    },
    notify: resolveProfileJobNotify(routine.notify, profileDefaults),
    createdAt: now,
    updatedAt: now,
    state: {},
    source: 'profile',
  };
}

/** 将 Profile routines.heartbeat 同步进 JobStore（M1.5 + M5） */
export async function syncProfileHeartbeatToStore(
  store: ScheduleJobStore,
  profile: AssistantProfile | null,
): Promise<boolean> {
  const routine = profile?.routines?.heartbeat;
  if (!routine || routine.enabled === false) return false;

  const job = buildHeartbeatJobFromRoutine(routine, profile?.defaults?.notify);
  await store.upsertJob(job);
  return true;
}

const PROFILE_CRON_LABELS: Record<string, string> = {
  morningBrief: '早报',
  bedtimeCheck: '睡前巡检',
  weatherReport: '天气早报',
};

/** 将 Profile routines 中的 cron 调度 Job 同步进 JobStore（含 weatherReport 等扩展 routine） */
export async function syncProfileRoutinesToStore(
  store: ScheduleJobStore,
  profile: AssistantProfile | null,
): Promise<number> {
  if (!profile?.routines) return 0;
  const profileDefaults = profile.defaults?.notify;
  let synced = 0;
  for (const [key, routine] of Object.entries(profile.routines)) {
    if (!isCronRoutine(key, routine)) continue;
    if (routine.enabled === false || !routine.cron?.trim() || !routine.prompt?.trim()) continue;
    const jobId = profileCronJobId(key);
    const defaultLabel = PROFILE_CRON_LABELS[key] ?? key;
    await store.upsertJob(buildScheduleJobFromRoutine(jobId, defaultLabel, routine, profileDefaults));
    synced++;
  }
  return synced;
}

/** 移除 profile 中已删除的 cron routine 对应 Job（避免 schedule-jobs.json 残留旧条目） */
export async function pruneStaleProfileCronJobs(
  store: ScheduleJobStore,
  profile: AssistantProfile | null,
): Promise<number> {
  const activeCronIds = new Set<string>();
  if (profile?.routines) {
    for (const [key, routine] of Object.entries(profile.routines)) {
      if (!isCronRoutine(key, routine)) continue;
      if (routine.enabled === false || !routine.cron?.trim() || !routine.prompt?.trim()) continue;
      activeCronIds.add(profileCronJobId(key));
    }
  }
  const jobs = await store.listJobs();
  let removed = 0;
  for (const job of jobs) {
    if (job.source !== 'profile') continue;
    if (job.id === PROFILE_HEARTBEAT_JOB_ID) continue;
    if (job.schedule.kind === 'every' && job.action.kind === 'heartbeat') continue;
    if (activeCronIds.has(job.id)) continue;
    if (await store.removeJob(job.id)) removed++;
  }
  return removed;
}

/** @deprecated */
export const syncProfileCronRoutinesToStore = syncProfileRoutinesToStore;

/** 合并 Profile + assistant.home 的设备别名 */
export function mergeProfileDeviceAliases(
  profile: AssistantProfile | null,
  aliases: Record<string, string> = {},
): Record<string, string> {
  if (!profile?.devices) return { ...aliases };
  return { ...aliases, ...profile.devices };
}

export function validateAssistantProfile(profile: AssistantProfile): string[] {
  const errors: string[] = [];
  const ver = profile.version ?? ASSISTANT_PROFILE_VERSION;
  if (ver !== ASSISTANT_PROFILE_VERSION) {
    errors.push(`unsupported profile version: ${ver}`);
  }
  if (profile.routines?.heartbeat?.everyMs != null && profile.routines.heartbeat.everyMs <= 0) {
    errors.push('routines.heartbeat.everyMs must be positive');
  }
  for (const key of Object.keys(profile.routines ?? {})) {
    if (key === 'heartbeat') continue;
    const routine = profile.routines?.[key as keyof typeof profile.routines];
    if (!isCronRoutine(key, routine)) continue;
    if (!routine.cron?.trim()) continue;
    if (!routine.prompt?.trim()) {
      errors.push(`routines.${key}.prompt is required when cron is set`);
    }
  }
  return errors;
}
