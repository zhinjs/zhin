import type {
  OrchestrationEventRecord,
  OrchestrationRunRecord,
  OrchestrationRunSource,
  OrchestrationTaskRecord,
} from '@zhin.js/ai';
import { parseDependsOn } from '@zhin.js/ai';
import type { OrchestrationRun, OrchestrationTask, RunEvent } from './kernel-types.js';

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function mapRunRecord(record: OrchestrationRunRecord): OrchestrationRun {
  return {
    id: record.id,
    sessionKey: record.session_key,
    status: record.status,
    title: record.title,
    source: parseJsonObject(record.source_json) as OrchestrationRunSource | undefined,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export function mapTaskRecord(record: OrchestrationTaskRecord): OrchestrationTask {
  return {
    id: record.id,
    runId: record.run_id,
    name: record.name,
    description: record.description,
    role: record.role,
    goal: record.goal,
    status: record.status,
    dependsOn: parseDependsOn(record.depends_on),
    executorKind: record.executor_kind,
    assignedTo: record.assigned_to || undefined,
    remoteAgentId: record.remote_agent_id || undefined,
    resultSummary: record.result_summary || undefined,
    error: record.error || undefined,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export function mapEventRecord(record: OrchestrationEventRecord): RunEvent {
  return {
    id: record.id,
    runId: record.run_id,
    taskId: record.task_id || undefined,
    type: record.type,
    seq: record.seq,
    payload: parseJsonObject(record.payload_json) ?? {},
    createdAt: record.created_at,
  };
}
