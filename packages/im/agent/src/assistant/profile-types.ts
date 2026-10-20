/**
 * Assistant Profile schema（M5）
 */
import type { JobNotify } from './types.js';

export const ASSISTANT_PROFILE_VERSION = 1;
export const DEFAULT_PROFILE_FILENAME = 'assistant.profile.yml';

export interface AssistantProfileRoutineHeartbeat {
  enabled?: boolean;
  everyMs?: number;
  prompt?: string;
  notify?: JobNotify;
}

export interface AssistantProfileRoutineCron {
  enabled?: boolean;
  label?: string;
  /** 调度语义，默认 solar；中国大陆「工作日」请用 workday（含调休），不要用 solar 的 1-5 */
  scheduleKind?: 'solar' | 'lunar' | 'workday' | 'freeDay' | 'holiday';
  /** cron 表达式（5 或 6 段；workday 仅需时刻，日/月/周应为 *） */
  cron: string;
  tz?: string;
  prompt: string;
  notify?: JobNotify;
}

export interface AssistantProfileRoutines {
  heartbeat?: AssistantProfileRoutineHeartbeat;
  /** 早报（默认 08:00） */
  morningBrief?: AssistantProfileRoutineCron;
  /** 睡前巡检（默认 22:00） */
  bedtimeCheck?: AssistantProfileRoutineCron;
  /** 工作日天气早报等自定义 cron routine */
  weatherReport?: AssistantProfileRoutineCron;
  [key: string]: AssistantProfileRoutineCron | AssistantProfileRoutineHeartbeat | undefined;
}

export interface AssistantProfile {
  version?: number;
  persona?: {
    soul?: string;
  };
  /** 对应 AGENTS.md 正文 */
  agents?: string;
  /** 对应 TOOLS.md 正文 */
  tools?: string;
  defaults?: {
    notify?: JobNotify;
    notifyOnFailure?: boolean;
  };
  routines?: AssistantProfileRoutines;
  /** 可选：与 assistant.home.aliases 对齐的设备别名 */
  devices?: Record<string, string>;
}

export interface AssistantProfileConfig {
  /** 启用 Profile 覆盖 Bootstrap（默认 false） */
  enabled?: boolean;
  /** 相对项目根路径，默认 assistant.profile.yml */
  file?: string;
}

export const DEFAULT_HEARTBEAT_PROMPT = `Read HEARTBEAT.md in your workspace (if it exists).
Follow any instructions or tasks listed there.
If nothing needs attention, reply with just: HEARTBEAT_OK`;

export const PROFILE_HEARTBEAT_JOB_ID = 'assistant-profile-heartbeat';
export const PROFILE_MORNING_BRIEF_JOB_ID = 'assistant-profile-morning-brief';
export const PROFILE_BEDTIME_CHECK_JOB_ID = 'assistant-profile-bedtime-check';
