/**
 * Scheduler types
 *
 * 支持三种调度：at（单次指定时间）、every（固定间隔）、cron（表达式）
 * Payload 支持 agent_turn（到点执行 prompt）、heartbeat（读 HEARTBEAT.md）、system_event
 */

export interface Schedule {
  kind: 'at' | 'every' | 'cron';
  /** 单次执行时间戳（kind=at） */
  atMs?: number;
  /** 间隔毫秒（kind=every） */
  everyMs?: number;
  /** Cron 表达式（kind=cron） */
  expr?: string;
  /** 时区（kind=cron 可选） */
  tz?: string;
}

export interface JobPayload {
  kind: 'system_event' | 'agent_turn' | 'heartbeat';
  /** 触发时发给 AI 的 prompt（agent_turn）或 heartbeat 说明 */
  message: string;
  /** 是否投递到指定 channel/user */
  deliver: boolean;
  channel?: string;
  to?: string;
}

export interface JobState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
}

export interface ScheduledJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: Schedule;
  payload: JobPayload;
  state: JobState;
  createdAtMs: number;
  updatedAtMs: number;
  /** 单次任务执行后是否删除 */
  deleteAfterRun: boolean;
}

export interface JobStore {
  version: number;
  jobs: ScheduledJob[];
}

export type JobCallback = (job: ScheduledJob) => Promise<void>;

export interface AddJobOptions {
  name: string;
  schedule: Schedule;
  payload: JobPayload;
  enabled?: boolean;
  deleteAfterRun?: boolean;
}

export interface IScheduler {
  start(): Promise<void>;
  stop(): void;
  addJob(options: AddJobOptions): ScheduledJob;
  removeJob(jobId: string): boolean;
  enableJob(jobId: string, enabled: boolean): boolean;
  runJob(jobId: string): Promise<void>;
  listJobs(): ScheduledJob[];
  status(): { running: boolean; jobCount: number; nextWakeAt?: number };
}
