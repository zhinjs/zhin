/**
 * /collab 协作群管理指令（仅 master；ADR 0023 Cell 注册 SSOT）。
 */
import { type Message } from '@zhin.js/core';
import { getCollaborationSceneService } from './scene-service.js';
import {
  findCellForMessage,
  memberTransportAdapter,
  resolvePeerEndpointInCell,
} from './collaboration-config.js';
import { rebootstrapEndpointRuntimes } from './bootstrap-agent-runtimes.js';
import { getPipelineService } from '../aop/pipeline/pipeline-service.js';
import {
  isPipelineRole,
  PIPELINE_ROLES,
  type CollaborationScene,
  type PipelineRole,
} from './types.js';
import { cancelInitWizard } from './init-wizard-service.js';
import { getOrchestrationService } from '../orchestrator/orchestration-service.js';

const PIPELINE_ROLE_LABELS_ZH: Record<PipelineRole, string> = {
  planner: '规划员',
  researcher: '调研员',
  evaluator: '评估员',
  executor: '执行员',
  reviewer: '评审员',
};

export interface BindableEndpointRef {
  adapter: string;
  id: string;
  online: boolean;
}

function isKnownAdapter(_adapterName: string): boolean {
  return false;
}

function listAllBindableEndpoints(_cell: CollaborationScene): BindableEndpointRef[] {
  return [];
}

function listBindableEndpointsForAdapter(
  adapterName: string,
  cell: CollaborationScene,
): BindableEndpointRef[] {
  return listAllBindableEndpoints(cell).filter((ep) => ep.adapter === adapterName);
}

function resolveEndpointAcrossAdapters(
  _endpointId: string,
  _preferAdapter?: string,
): BindableEndpointRef | undefined {
  return undefined;
}

function listProvisionableAdapterNames(): string[] {
  return [];
}

function formatEndpointRefLabel(ref: BindableEndpointRef): string {
  return `${ref.adapter}/${ref.id}`;
}

function formatBindCommand(ref: BindableEndpointRef, role?: PipelineRole): string {
  const roleSuffix = role ? ` ${role}` : ' <pipelineRole>';
  return `/collab bind ${ref.adapter} ${ref.id}${roleSuffix}`;
}

function availablePipelineRoles(cell: CollaborationScene): PipelineRole[] {
  const taken = new Set(
    cell.members.map((m) => m.pipelineRole).filter((r): r is PipelineRole => !!r),
  );
  return PIPELINE_ROLES.filter((r) => !taken.has(r));
}

function formatAdapterBindPrompt(cell: CollaborationScene): string {
  const adapters = listProvisionableAdapterNames();
  if (adapters.length === 0) {
    return '当前没有可绑定的适配器 Endpoint。可用 /endpoints 查看。';
  }
  return [
    '可选适配器：',
    ...adapters.map((a) => `  • ${a} — /collab bind ${a}`),
  ].join('\n');
}

function formatEndpointBindPrompt(
  cell: CollaborationScene,
  role?: PipelineRole,
  adapterFilter?: string,
): string {
  const endpoints = adapterFilter
    ? listBindableEndpointsForAdapter(adapterFilter, cell)
    : listAllBindableEndpoints(cell);
  if (endpoints.length === 0) {
    if (adapterFilter) {
      return `适配器 ${adapterFilter} 下没有可绑定的 Endpoint（可能已全部绑定）。`;
    }
    return '当前没有可绑定的 Endpoint（已全部绑定或系统无 Bot）。可用 /endpoints 查看。';
  }
  return [
    adapterFilter ? `可选 Endpoint（${adapterFilter}）：` : '可选 Endpoint（adapter/endpoint）：',
    ...endpoints.map((ep) => {
      const status = ep.online ? '在线' : '离线';
      return `  • ${formatEndpointRefLabel(ep)} (${status}) — ${formatBindCommand(ep, role)}`;
    }),
  ].join('\n');
}

function formatRoleBindPrompt(
  cell: CollaborationScene,
  endpointRef?: BindableEndpointRef,
): string {
  const roles = availablePipelineRoles(cell);
  if (roles.length === 0) {
    return '所有 pipeline 角色已占用。请先用 /collab unbind 移除成员。';
  }
  return [
    '可选 pipeline 角色：',
    ...roles.map((r) => {
      const cmd = endpointRef
        ? formatBindCommand(endpointRef, r)
        : `/collab bind <adapter> <endpoint> ${r}`;
      return `  • ${r} (${PIPELINE_ROLE_LABELS_ZH[r]}) — ${cmd}`;
    }),
  ].join('\n');
}

function formatMemberEndpointLabel(cell: CollaborationScene, member: CollaborationScene['members'][number]): string {
  const adapter = memberTransportAdapter(cell, member);
  return adapter === cell.adapter ? member.endpointId : `${adapter}/${member.endpointId}`;
}

function parseBindArgs(
  cell: CollaborationScene,
  adapterArg: string,
  endpointArg: string,
  roleArg: string,
): { adapter: string; endpoint: string; role: string } {
  let adapter = adapterArg.trim();
  let endpoint = endpointArg.trim();
  let role = roleArg.trim();

  if (adapter && !endpoint && !role && isPipelineRole(adapter)) {
    role = adapter;
    adapter = '';
  }

  if (adapter && !endpoint && !role && isKnownAdapter(adapter)) {
    return { adapter, endpoint: '', role: '' };
  }

  if (adapter && endpoint && !role && isPipelineRole(endpoint)) {
    role = endpoint;
    endpoint = adapter;
    adapter = '';
  }

  if (adapter && !endpoint && !role && !isKnownAdapter(adapter)) {
    endpoint = adapter;
    adapter = '';
  }

  if (adapter && endpoint && !role && isKnownAdapter(adapter)) {
    return { adapter, endpoint, role: '' };
  }

  if (endpoint && !adapter) {
    const resolved = resolveEndpointAcrossAdapters(endpoint, cell.adapter);
    adapter = resolved?.adapter ?? cell.adapter;
  }

  return { adapter, endpoint, role };
}

export { defaultCellId } from './collab-utils.js';

export function resolveSceneFromMessage(message: Message):
  | { ok: true; adapter: string; sceneId: string }
  | { ok: false; error: string } {
  const scope = message.$channel?.type;
  if (scope !== 'group' && scope !== 'channel') {
    return { ok: false, error: '仅支持群/频道内使用 /collab 指令。' };
  }
  const sceneId = message.$channel?.id;
  if (!sceneId) return { ok: false, error: '无法解析当前群号。' };
  const adapter = String(message.$adapter ?? '');
  if (!adapter) return { ok: false, error: '无法解析当前适配器。' };
  return { ok: true, adapter, sceneId: String(sceneId) };
}


function formatMemberLine(cell: CollaborationScene): string {
  return cell.members
    .map((m) => {
      const role = m.pipelineRole ?? m.primary;
      return `  • ${formatMemberEndpointLabel(cell, m)} (${role})`;
    })
    .join('\n');
}

async function formatStatus(cell: CollaborationScene): Promise<string> {
  const lines = [
    `协作群 ${cell.id}`,
    `  adapter: ${cell.adapter}`,
    `  scene: ${cell.sceneId}`,
    `  goal: ${cell.goal?.trim() || '(未设置)'}`,
    `  members (${cell.members.length}):`,
    formatMemberLine(cell) || '  (无成员 — 使用 /collab bind)',
  ];

  const runId = cell.missionRunId?.trim();
  if (runId) {
    lines.push(`  kernel run: ${runId}`);
    const orch = getOrchestrationService();
    if (orch) {
      const snapshot = await orch.getStatus(runId);
      if (snapshot) {
        const active = snapshot.tasks.filter((t) =>
          ['pending', 'assigned', 'running', 'waiting_result'].includes(t.status),
        ).length;
        lines.push(
          `  run status: ${snapshot.run.status}; tasks: ${snapshot.tasks.length} (${active} active)`,
        );
      }
    }
  } else {
    lines.push('  kernel run: (none — Planner 使用 orchestration_start 或群内 @Planner 启动)');
  }

  const pipeline = cell.pipelineState;
  if (pipeline?.activeDelegations?.length) {
    lines.push(
      `  legacy delegations: ${pipeline.activeDelegations.length} (deprecated — 见 kernel run / orchestration_status)`,
    );
  }
  if (pipeline && !runId) {
    lines.push(
      `  legacy pipeline: ${pipeline.stage} (run ${pipeline.runId.slice(0, 8)}…) — ADR 0026 起请用 kernel`,
    );
  }

  return lines.join('\n');
}

function collabAdminBlocked(_message: Message): boolean {
  return true;
}

export async function handleCollabStatus(message: Message): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `ℹ️ ${scene.error}`;
  if (collabAdminBlocked(message)) return '';
  const svc = getCollaborationSceneService();
  await svc.reloadFromRepository();
  const cell = findCellForMessage(svc.listScenes(), scene.adapter, scene.sceneId);
  if (!cell) {
    return [
      '当前群尚未注册为协作 Cell。',
      '用法：/collab init [协作目标]',
      '      /collab bind <endpoint> <pipelineRole>',
    ].join('\n');
  }
  return await formatStatus(cell);
}


export async function handleCollabBindPrompt(
  message: Message,
  adapterRef?: string,
  endpointRef?: string,
  pipelineRoleRaw?: string,
  primaryArg?: string,
): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `⚠️ ${scene.error}`;
  if (collabAdminBlocked(message)) return '';

  const svc = getCollaborationSceneService();
  await svc.reloadFromRepository();
  const cell = findCellForMessage(svc.listScenes(), scene.adapter, scene.sceneId);
  if (!cell) return '⚠️ 当前群未注册协作 Cell。请先 /collab init';

  const { adapter, endpoint, role } = parseBindArgs(
    cell,
    adapterRef ?? '',
    endpointRef ?? '',
    pipelineRoleRaw ?? '',
  );

  if (!adapter && !endpoint && !role) {
    return [
      '请指定 adapter、Endpoint 与 pipeline 角色：',
      '',
      formatAdapterBindPrompt(cell),
      '',
      formatEndpointBindPrompt(cell),
      '',
      formatRoleBindPrompt(cell),
    ].join('\n');
  }

  if (adapter && isKnownAdapter(adapter) && !endpoint && !role) {
    return [
      `已选适配器：${adapter}`,
      '请选择 Endpoint：',
      '',
      formatEndpointBindPrompt(cell, undefined, adapter),
      '',
      '也可换适配器：',
      formatAdapterBindPrompt(cell),
    ].join('\n');
  }

  if (endpoint && !role) {
    const endpointRefResolved = resolveEndpointAcrossAdapters(endpoint, adapter || cell.adapter);
    const label = endpointRefResolved ? formatEndpointRefLabel(endpointRefResolved) : endpoint;
    return [
      `已选 Endpoint：${label}`,
      '请选择 pipeline 角色：',
      '',
      formatRoleBindPrompt(cell, endpointRefResolved),
    ].join('\n');
  }

  if (!endpoint && role) {
    if (!isPipelineRole(role)) {
      return `⚠️ pipelineRole 须为：${PIPELINE_ROLES.join(' | ')}`;
    }
    const roleLabel = PIPELINE_ROLE_LABELS_ZH[role];
    const adapterFilter = adapter && isKnownAdapter(adapter) ? adapter : undefined;
    return [
      `已选角色：${role} (${roleLabel})`,
      '请选择 Endpoint：',
      '',
      formatEndpointBindPrompt(cell, role, adapterFilter),
    ].join('\n');
  }

  if (!endpoint) {
    return formatEndpointBindPrompt(cell, isPipelineRole(role) ? role : undefined, adapter || undefined);
  }

  return handleCollabBind(
    message,
    endpoint,
    role,
    primaryArg,
    adapter && isKnownAdapter(adapter) ? adapter : undefined,
  );
}

export async function handleCollabBind(
  message: Message,
  endpointRef: string,
  pipelineRoleRaw: string,
  primaryArg?: string,
  memberAdapter?: string,
): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `⚠️ ${scene.error}`;
  if (collabAdminBlocked(message)) return '';
  if (!isPipelineRole(pipelineRoleRaw)) {
    return `⚠️ pipelineRole 须为：${PIPELINE_ROLES.join(' | ')}`;
  }

  const svc = getCollaborationSceneService();
  await svc.reloadFromRepository();
  let cell = findCellForMessage(svc.listScenes(), scene.adapter, scene.sceneId);
  if (!cell) {
    return '⚠️ 当前群未注册协作 Cell。请先 /collab init';
  }

  const ref = endpointRef.trim();
  const endpointId = resolvePeerEndpointInCell(cell, ref) ?? ref;
  const primary = primaryArg?.trim() || pipelineRoleRaw;
  const transportAdapter = memberAdapter?.trim()
    || resolveEndpointAcrossAdapters(endpointId, cell.adapter)?.adapter
    || cell.adapter;

  const added = await svc.addMember(cell.id, {
    endpointId,
    adapter: transportAdapter !== cell.adapter ? transportAdapter : undefined,
    primary,
    pipelineRole: pipelineRoleRaw,
  });
  if (!added.ok) return `⚠️ 绑定失败：${added.error ?? 'unknown'}`;

  cell = (await svc.getSceneFresh(cell.id)) ?? cell;
  await rebootstrapEndpointRuntimes();
  const label = transportAdapter === cell.adapter
    ? endpointId
    : `${transportAdapter}/${endpointId}`;
  return `✅ 已绑定 ${label} → ${pipelineRoleRaw}\n${await formatStatus(cell)}`;
}

export async function handleCollabUnbind(message: Message, endpointRef: string): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `⚠️ ${scene.error}`;
  if (collabAdminBlocked(message)) return '';

  const svc = getCollaborationSceneService();
  await svc.reloadFromRepository();
  const cell = findCellForMessage(svc.listScenes(), scene.adapter, scene.sceneId);
  if (!cell) return '⚠️ 当前群未注册协作 Cell。';

  const ref = endpointRef.trim();
  const endpointId = resolvePeerEndpointInCell(cell, ref) ?? ref;
  const ok = await svc.removeMember(cell.id, endpointId);
  if (!ok) return `⚠️ 未找到成员 ${endpointId}`;

  const fresh = (await svc.getSceneFresh(cell.id)) ?? cell;
  await rebootstrapEndpointRuntimes();
  return `✅ 已移除 ${endpointId}\n${await formatStatus(fresh)}`;
}

export async function handleCollabReset(message: Message, force = true): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `⚠️ ${scene.error}`;
  if (collabAdminBlocked(message)) return '';

  const svc = getCollaborationSceneService();
  await svc.reloadFromRepository();
  const cell = findCellForMessage(svc.listScenes(), scene.adapter, scene.sceneId);
  if (!cell) return '⚠️ 当前群未注册协作 Cell。请先 /collab init';

  if (!cell.pipelineState) {
    return `ℹ️ 协作群已注册，无 legacy pipeline 状态。\n${await formatStatus(cell)}`;
  }

  const result = await getPipelineService().resetRun(cell.id, { force });
  if (!result.ok) return `⚠️ 重置失败：${result.error}`;

  const fresh = (await svc.getSceneFresh(cell.id)) ?? cell;
  return (
    `✅ 已重置 legacy pipeline（run ${result.previousRunId?.slice(0, 8) ?? '?'} → ${result.state.runId.slice(0, 8)}）\n`
    + `新编排请用 orchestration_start / orchestration_status。\n`
    + `${await formatStatus(fresh)}`
  );
}

/**
 * /collab init @Planner — 启动 init 向导。
 * 被 @ 的 Bot 成为 Planner，开始程序化逐步提问。
 */
export async function handleCollabInitWizard(
  message: Message,
  _plannerAtId: string,
): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `⚠️ ${scene.error}`;
  return '⚠️ 系统未就绪。';
}

/**
 * /collab inited — 结束向导，Planner 汇聚观测并激活 Cell。
 */
export async function handleCollabInited(
  message: Message,
  _plannerPrimary?: string,
): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `⚠️ ${scene.error}`;
  return '⚠️ 系统未就绪。';
}

/**
 * /collab init-cancel — 取消进行中的 init 向导。
 */
export async function handleCollabInitCancel(
  message: Message,
): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `⚠️ ${scene.error}`;

  const result = await cancelInitWizard(scene.adapter, scene.sceneId);
  if (!result.ok) return `ℹ️ ${result.error}`;
  return '✅ Init 向导已取消。';
}

export function collabCommandUsage(): string {
  return [
    '协作群管理（仅 master）：',
    '  /collab — 查看状态',
    '  /collab init @Planner — 启动 init 向导（收集阶段：各 bot stash 观测）',
    '  /collab inited @Planner — 汇聚 stash，一次性创建协作 Cell',
    '  /collab init-cancel — 取消进行中的 init 向导',
    '  /collab bind [adapter] [endpoint] [pipelineRole] [primary] — 添加 Bot（缺参时列出可选项）',
    '  /collab unbind <endpoint> — 移除 Bot',
    '  /collab reset — 重置 pipeline（保留 Cell 绑定）',
  ].join('\n');
}
