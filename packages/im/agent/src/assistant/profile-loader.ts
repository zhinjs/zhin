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
import type { AssistantJobStore } from './job-store.js';
import type { AssistantJob } from './types.js';

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

export function buildCronJobFromRoutine(
  jobId: string,
  defaultLabel: string,
  routine: AssistantProfileRoutineCron,
): AssistantJob {
  const now = Date.now();
  return {
    id: jobId,
    label: routine.label?.trim() || defaultLabel,
    enabled: routine.enabled !== false,
    schedule: { kind: 'cron', expr: routine.cron.trim(), tz: routine.tz },
    action: { kind: 'agent', prompt: routine.prompt.trim() },
    notify: routine.notify ?? { channel: 'im' },
    createdAt: now,
    updatedAt: now,
    state: {},
    source: 'manual',
  };
}

export function buildHeartbeatJobFromRoutine(
  routine: AssistantProfileRoutineHeartbeat,
): AssistantJob {
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
    notify: routine.notify ?? { channel: 'silent' },
    createdAt: now,
    updatedAt: now,
    state: {},
    source: 'manual',
  };
}

/** 将 Profile routines.heartbeat 同步进 JobStore（M1.5 + M5） */
export async function syncProfileHeartbeatToStore(
  store: AssistantJobStore,
  profile: AssistantProfile | null,
): Promise<boolean> {
  const routine = profile?.routines?.heartbeat;
  if (!routine || routine.enabled === false) return false;

  const job = buildHeartbeatJobFromRoutine(routine);
  await store.upsertJob(job);
  return true;
}

const PROFILE_CRON_ROUTINES: Array<{
  key: 'morningBrief' | 'bedtimeCheck';
  jobId: string;
  defaultLabel: string;
}> = [
  { key: 'morningBrief', jobId: PROFILE_MORNING_BRIEF_JOB_ID, defaultLabel: '早报' },
  { key: 'bedtimeCheck', jobId: PROFILE_BEDTIME_CHECK_JOB_ID, defaultLabel: '睡前巡检' },
];

/** 将 Profile routines 中的 cron Job 同步进 JobStore */
export async function syncProfileCronRoutinesToStore(
  store: AssistantJobStore,
  profile: AssistantProfile | null,
): Promise<number> {
  if (!profile?.routines) return 0;
  let synced = 0;
  for (const { key, jobId, defaultLabel } of PROFILE_CRON_ROUTINES) {
    const routine = profile.routines[key];
    if (!routine || routine.enabled === false || !routine.cron?.trim() || !routine.prompt?.trim()) {
      continue;
    }
    await store.upsertJob(buildCronJobFromRoutine(jobId, defaultLabel, routine));
    synced++;
  }
  return synced;
}

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
  for (const { key } of [
    { key: 'morningBrief' as const },
    { key: 'bedtimeCheck' as const },
  ]) {
    const routine = profile.routines?.[key];
    if (!routine?.cron?.trim()) continue;
    if (!routine.prompt?.trim()) {
      errors.push(`routines.${key}.prompt is required when cron is set`);
    }
  }
  return errors;
}
