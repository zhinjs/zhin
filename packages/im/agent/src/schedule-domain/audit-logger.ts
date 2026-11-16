import { mkdir, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ScheduleJobCreator } from '../assistant/types.js';
import type { ScheduleBudgetTermination } from './budget-guard.js';
import type { ScheduleSecurityDenial } from './security-harness.js';

export interface ScheduleAuditRecord {
  jobId: string;
  executionId: string;
  timestamp: number;
  createdBy?: ScheduleJobCreator;
  prompt: string;
  toolsResolved: string[];
  toolsResolvedBy: 'execution-plan' | 'affinity';
  skillsResolved: string[];
  missingTools: string[];
  missingSkills: string[];
  toolsUsed: string[];
  toolCallCount: number;
  tokenUsage: { input: number; output: number };
  durationMs: number;
  budgetTerminated?: ScheduleBudgetTermination;
  securityDenials: ScheduleSecurityDenial[];
  success: boolean;
  outputLength: number;
  outputStripped: string[];
  error?: string;
  /** #1250 b33: capability warnings of the run (`empty_execution_plan`, `no_tools`). */
  warnings?: string[];
  /** #1250 b33: selected tools an unattended run cannot use without approval (informative). */
  unattendedApproval?: Readonly<{ review: 'auto' | 'none'; denied: string[]; reviewed: string[] }>;
  /** #1250 b33: the run finished but did not do what was asked (see `ScheduleExecutionResult.degraded`). */
  degraded?: ScheduleRunDegradation;
}

/** #1250 b33: why a finished run counts as degraded. */
export interface ScheduleRunDegradation {
  /** `no_tools` / `empty_reply` / `tool_denied`: see `ReplyFallback`; `tool_denied` also when the model still replied. */
  readonly cause: 'no_tools' | 'tool_denied' | 'empty_reply';
  readonly tools?: readonly string[];
  /** The delivered text is the framework's fallback (it already tells the reader what went wrong). */
  readonly fallback: boolean;
}

export function createScheduleAuditRecord(
  input: Omit<ScheduleAuditRecord, 'toolsUsed' | 'toolCallCount' | 'tokenUsage' | 'durationMs' | 'securityDenials' | 'success' | 'outputLength' | 'outputStripped'>
    & Partial<Pick<ScheduleAuditRecord, 'toolsUsed' | 'tokenUsage' | 'durationMs' | 'securityDenials' | 'success' | 'outputLength' | 'outputStripped'>>,
): ScheduleAuditRecord {
  const toolsUsed = input.toolsUsed ?? [];
  return {
    ...input,
    toolsUsed,
    toolCallCount: toolsUsed.length,
    tokenUsage: input.tokenUsage ?? { input: 0, output: 0 },
    durationMs: input.durationMs ?? 0,
    securityDenials: input.securityDenials ?? [],
    success: input.success ?? false,
    outputLength: input.outputLength ?? 0,
    outputStripped: input.outputStripped ?? [],
  };
}

export interface ScheduleAuditLogger {
  write(record: ScheduleAuditRecord): Promise<void>;
}

export class JsonlScheduleAuditLogger implements ScheduleAuditLogger {
  readonly filePath: string;

  constructor(dataDir = join(process.cwd(), 'data')) {
    this.filePath = join(dataDir, 'schedule-audit.jsonl');
  }

  async write(record: ScheduleAuditRecord): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
  }
}
