/**
 * CLI 侧 assistant-jobs.json 读写（与 @zhin.js/agent JobStore 格式对齐，避免 CLI 依赖 agent 包）
 */
import fs from 'fs-extra';
import path from 'path';
import YAML from 'yaml';

export const ASSISTANT_JOBS_FILENAME = 'assistant-jobs.json';
const CRON_JOBS_FILENAME = 'cron-jobs.json';

export type JobNotifyCli =
  | { channel: 'im'; platform?: string; botId?: string; senderId?: string; sceneId?: string; scope?: string }
  | { channel: 'silent' }
  | { channel: 'log' };

export function parseNotifyChannel(channel: string): JobNotifyCli {
  const ch = channel.trim().toLowerCase();
  if (ch === 'im') return { channel: 'im' };
  if (ch === 'log') return { channel: 'log' };
  if (ch === 'silent') return { channel: 'silent' };
  throw new Error(`notify channel 无效: ${channel}，可选 im | silent | log`);
}

export interface CronJobRecordCli {
  id: string;
  cronExpression: string;
  prompt: string;
  label?: string;
  enabled: boolean;
  notify: JobNotifyCli;
  createdAt: number;
  lastExecutedAt?: number;
  lastStatus?: 'ok' | 'error';
  lastError?: string;
}

interface AssistantJobCli {
  id: string;
  label?: string;
  enabled: boolean;
  schedule: { kind: 'cron'; expr: string };
  action: { kind: 'agent'; prompt: string };
  notify: JobNotifyCli;
  createdAt: number;
  updatedAt: number;
  state: {
    lastExecutedAt?: number;
    lastStatus?: string;
    lastError?: string;
  };
  source?: string;
}

interface AssistantJobFileCli {
  version: number;
  jobs: AssistantJobCli[];
}

function requireNotify(raw: unknown, jobId: string): JobNotifyCli {
  const notify = raw as JobNotifyCli | undefined;
  if (!notify || typeof notify !== 'object' || !('channel' in notify)) {
    throw new Error(`job "${jobId}" 缺少 notify（context 已移除，请改用 notify）`);
  }
  return notify;
}

function getDataDir(cwd = process.cwd()): string {
  return path.join(cwd, 'data');
}

function getAssistantJobsPath(cwd = process.cwd()): string {
  return path.join(getDataDir(cwd), ASSISTANT_JOBS_FILENAME);
}

function getCronJobsPath(cwd = process.cwd()): string {
  return path.join(getDataDir(cwd), CRON_JOBS_FILENAME);
}

async function readAssistantConfigBlock(cwd: string): Promise<{ enabled?: boolean; legacyDualWrite?: boolean } | undefined> {
  const candidates = ['zhin.config.yml', 'zhin.config.yaml'];
  for (const name of candidates) {
    const filePath = path.join(cwd, name);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const doc = YAML.parse(raw) as { assistant?: { enabled?: boolean; legacyDualWrite?: boolean } } | null;
      if (doc?.assistant) return doc.assistant;
    } catch {
      // ignore
    }
  }
  return undefined;
}

async function readConfigAssistantEnabled(cwd: string): Promise<boolean> {
  const assistant = await readAssistantConfigBlock(cwd);
  return assistant?.enabled === true;
}

async function readConfigLegacyDualWrite(cwd: string): Promise<boolean> {
  const assistant = await readAssistantConfigBlock(cwd);
  return assistant?.legacyDualWrite === true;
}

export async function shouldUseAssistantJobStore(cwd = process.cwd()): Promise<boolean> {
  if (await readConfigAssistantEnabled(cwd)) return true;
  return fs.pathExists(getAssistantJobsPath(cwd));
}

function cronToAssistant(record: CronJobRecordCli): AssistantJobCli {
  const now = Date.now();
  return {
    id: record.id,
    label: record.label,
    enabled: record.enabled,
    schedule: { kind: 'cron', expr: record.cronExpression },
    action: { kind: 'agent', prompt: record.prompt },
    notify: record.notify,
    createdAt: record.createdAt,
    updatedAt: record.createdAt,
    state: {
      lastExecutedAt: record.lastExecutedAt,
      lastStatus: record.lastStatus,
      lastError: record.lastError,
    },
    source: 'manual',
  };
}

function assistantToCron(job: AssistantJobCli): CronJobRecordCli | null {
  if (job.schedule.kind !== 'cron' || job.action.kind !== 'agent') return null;
  return {
    id: job.id,
    cronExpression: job.schedule.expr,
    prompt: job.action.prompt,
    label: job.label,
    enabled: job.enabled,
    notify: job.notify,
    createdAt: job.createdAt,
    lastExecutedAt: job.state.lastExecutedAt,
    lastStatus: job.state.lastStatus === 'ok' || job.state.lastStatus === 'error'
      ? job.state.lastStatus
      : undefined,
    lastError: job.state.lastError,
  };
}

function parseCronRecord(raw: Record<string, unknown>): CronJobRecordCli {
  const id = String(raw.id);
  return {
    id,
    cronExpression: String(raw.cronExpression),
    prompt: String(raw.prompt),
    label: raw.label != null ? String(raw.label) : undefined,
    enabled: raw.enabled !== false,
    notify: requireNotify(raw.notify, id),
    createdAt: Number(raw.createdAt) || Date.now(),
    lastExecutedAt: raw.lastExecutedAt != null ? Number(raw.lastExecutedAt) : undefined,
    lastStatus: raw.lastStatus === 'ok' || raw.lastStatus === 'error' ? raw.lastStatus : undefined,
    lastError: raw.lastError != null ? String(raw.lastError) : undefined,
  };
}

async function readAssistantStore(cwd: string): Promise<AssistantJobFileCli> {
  const filePath = getAssistantJobsPath(cwd);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as AssistantJobFileCli;
    const jobs = (Array.isArray(data.jobs) ? data.jobs : []).map((j) => {
      if (!j.notify) throw new Error(`assistant-jobs.json: job "${j.id}" 缺少 notify`);
      return j;
    });
    return { version: data.version ?? 1, jobs };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') return { version: 1, jobs: [] };
    throw e;
  }
}

async function writeAssistantStore(cwd: string, store: AssistantJobFileCli, dualWrite: boolean): Promise<void> {
  const filePath = getAssistantJobsPath(cwd);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
  if (dualWrite) {
    const cronRecords = store.jobs.map(assistantToCron).filter((j): j is CronJobRecordCli => j != null);
    await fs.writeFile(getCronJobsPath(cwd), JSON.stringify(cronRecords, null, 2), 'utf-8');
  }
}

async function readLegacyCronJobs(cwd: string): Promise<CronJobRecordCli[]> {
  const filePath = getCronJobsPath(cwd);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data as Record<string, unknown>[] : [];
    return list.map(parseCronRecord);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') return [];
    throw e;
  }
}

export async function readCronJobsUnified(cwd = process.cwd()): Promise<CronJobRecordCli[]> {
  if (await shouldUseAssistantJobStore(cwd)) {
    const store = await readAssistantStore(cwd);
    const fromAssistant = store.jobs.map(assistantToCron).filter((j): j is CronJobRecordCli => j != null);
    if (fromAssistant.length > 0) return fromAssistant;
    return readLegacyCronJobs(cwd);
  }
  return readLegacyCronJobs(cwd);
}

export async function writeCronJobsUnified(cwd: string, jobs: CronJobRecordCli[]): Promise<void> {
  if (await shouldUseAssistantJobStore(cwd)) {
    const existing = await readAssistantStore(cwd);
    const nonCron = existing.jobs.filter((j) => j.schedule.kind !== 'cron');
    const store: AssistantJobFileCli = {
      version: 1,
      jobs: [...nonCron, ...jobs.map(cronToAssistant)],
    };
    const dualWrite = await readConfigLegacyDualWrite(cwd);
    await writeAssistantStore(cwd, store, dualWrite);
    return;
  }
  await fs.ensureDir(getDataDir(cwd));
  await fs.writeFile(getCronJobsPath(cwd), JSON.stringify(jobs, null, 2), 'utf-8');
}
