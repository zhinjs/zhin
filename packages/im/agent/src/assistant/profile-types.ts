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
  /** 5 字段 cron 表达式 */
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
