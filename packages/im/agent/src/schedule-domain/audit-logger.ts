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
