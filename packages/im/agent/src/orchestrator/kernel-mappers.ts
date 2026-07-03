import type {
  OrchestrationEventRecord,
  OrchestrationExecutorKind,
  OrchestrationRunRecord,
  OrchestrationRunSource,
  OrchestrationSceneKind,
  OrchestrationSceneRef,
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

const SCENE_KINDS = new Set<OrchestrationSceneKind>(['private', 'group', 'channel']);

function isSceneKind(value: unknown): value is OrchestrationSceneKind {
  return typeof value === 'string' && SCENE_KINDS.has(value as OrchestrationSceneKind);
}

function parseSceneRef(raw: unknown): OrchestrationSceneRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (!isSceneKind(o.kind)) return undefined;
  const platform = typeof o.platform === 'string' ? o.platform : '';
  const endpointId = typeof o.endpointId === 'string' ? o.endpointId : '';
  const sceneId = typeof o.sceneId === 'string' ? o.sceneId : '';
  if (!platform || !endpointId || !sceneId) return undefined;
  const parentRaw = o.parent;
  const parent = parentRaw && typeof parentRaw === 'object'
    ? (() => {
        const p = parentRaw as Record<string, unknown>;
        const pk = p.kind;
        const ps = p.sceneId;
        if ((pk === 'group' || pk === 'channel') && typeof ps === 'string') {
          return { kind: pk as 'group' | 'channel', sceneId: ps };
        }
        return undefined;
      })()
    : undefined;
  return {
    platform,
    endpointId,
    sceneId,
    kind: o.kind,
    ...(typeof o.senderId === 'string' ? { senderId: o.senderId } : {}),
    ...(parent ? { parent } : {}),
  };
}

/** 读取 DB JSON 时归一化 legacy im_cell / im_session → im_scene */
export function normalizeRunSource(raw: unknown): OrchestrationRunSource | undefined {
  if (!raw || typeof raw !== 'object' || !('kind' in raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'im_scene') {
    const scene = parseSceneRef(o.scene);
    if (!scene) return undefined;
    return {
      kind: 'im_scene',
      scene,
      ...(typeof o.cellId === 'string' && o.cellId ? { cellId: o.cellId } : {}),
    };
  }
  if (o.kind === 'im_cell') {
    const adapter = typeof o.adapter === 'string' ? o.adapter : '';
    const sceneId = typeof o.sceneId === 'string' ? o.sceneId : '';
    const cellId = typeof o.cellId === 'string' ? o.cellId : '';
    if (!adapter || !sceneId || !cellId) return undefined;
    return {
      kind: 'im_scene',
      cellId,
      scene: {
        platform: adapter,
        endpointId: '',
        sceneId,
        kind: 'group',
      },
    };
  }
  if (o.kind === 'im_session') {
    const adapter = typeof o.adapter === 'string' ? o.adapter : '';
    const endpointId = typeof o.endpointId === 'string' ? o.endpointId : '';
    if (!adapter || !endpointId) return undefined;
    const sceneId = typeof o.sceneId === 'string' ? o.sceneId : endpointId;
    return {
      kind: 'im_scene',
      scene: {
        platform: adapter,
        endpointId,
        sceneId,
        kind: 'private',
      },
    };
  }
  if (o.kind === 'manual') {
    return {
      kind: 'manual',
      ...(typeof o.label === 'string' ? { label: o.label } : {}),
    };
  }
  return undefined;
}

export function normalizeExecutorKind(kind: string): OrchestrationExecutorKind {
  if (kind === 'group_mention') return 'scene_mention';
  if (kind === 'scene_mention' || kind === 'local' || kind === 'remote_mesh') return kind;
  return 'local';
}

export function mapRunRecord(record: OrchestrationRunRecord): OrchestrationRun {
  return {
    id: record.id,
    sessionKey: record.session_key,
    status: record.status,
    title: record.title,
    source: normalizeRunSource(parseJsonObject(record.source_json)),
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
    executorKind: normalizeExecutorKind(record.executor_kind),
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
