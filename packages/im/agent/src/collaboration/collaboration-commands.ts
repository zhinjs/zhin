/**
 * /collab 协作群管理指令（仅 master；ADR 0023 Cell 注册 SSOT）。
 */
import { Adapter, getHostRootPlugin, type Message } from '@zhin.js/core';
import { getCollaborationCellService } from './cell-service.js';
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
  type CollaborationCell,
  type CollaborationConfig,
  type PipelineRole,
} from './types.js';
import { getSceneIdentityService } from './scene-identity-service.js';
import { startInitWizard, aggregateAndActivate, cancelInitWizard } from './init-wizard-service.js';
import { extractAtTargets, buildRegisteredEndpointMap } from './init-observe-hook.js';
import { checkCollabAdminGate } from './collab-admin-gate.js';

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

function isKnownAdapter(adapterName: string): boolean {
  const root = getHostRootPlugin();
  if (!root || !adapterName) return false;
  const adapter = root.inject(adapterName);
  return adapter instanceof Adapter;
}

function listAdapterEndpoints(adapterName: string): Array<{ id: string; online: boolean }> {
  const root = getHostRootPlugin();
  if (!root) return [];
  const adapter = root.inject(adapterName);
  if (!(adapter instanceof Adapter)) return [];
  return [...adapter.endpoints.entries()].map(([id, endpoint]) => ({
    id,
    online: !!(endpoint as { $connected?: boolean }).$connected,
  }));
}

function memberBindKey(cell: CollaborationCell, member: CollaborationCell['members'][number]): string {
  return `${memberTransportAdapter(cell, member)}:${member.endpointId}`;
}

function listAllBindableEndpoints(cell: CollaborationCell): BindableEndpointRef[] {
  const root = getHostRootPlugin();
  if (!root) return [];
  const bound = new Set(cell.members.map((m) => memberBindKey(cell, m)));
  const out: BindableEndpointRef[] = [];
  for (const adapterName of root.adapters) {
    const name = String(adapterName);
    for (const ep of listAdapterEndpoints(name)) {
      const key = `${name}:${ep.id}`;
      if (bound.has(key)) continue;
      out.push({ adapter: name, id: ep.id, online: ep.online });
    }
  }
  return out;
}

function listBindableEndpointsForAdapter(
  adapterName: string,
  cell: CollaborationCell,
): BindableEndpointRef[] {
  return listAllBindableEndpoints(cell).filter((ep) => ep.adapter === adapterName);
}

function resolveEndpointAcrossAdapters(
  endpointId: string,
  preferAdapter?: string,
): BindableEndpointRef | undefined {
  const root = getHostRootPlugin();
  if (!root) return undefined;
  const matches: BindableEndpointRef[] = [];
  for (const adapterName of root.adapters) {
    const name = String(adapterName);
    for (const ep of listAdapterEndpoints(name)) {
      if (ep.id === endpointId) {
        matches.push({ adapter: name, id: ep.id, online: ep.online });
      }
    }
  }
  if (matches.length === 0) return undefined;
  if (preferAdapter) {
    const preferred = matches.find((m) => m.adapter === preferAdapter);
    if (preferred) return preferred;
  }
  return matches[0];
}

function listProvisionableAdapterNames(): string[] {
  const root = getHostRootPlugin();
  if (!root) return [];
  return root.adapters
    .map((name) => String(name))
    .filter((name) => listAdapterEndpoints(name).length > 0);
}

function formatEndpointRefLabel(ref: BindableEndpointRef): string {
  return `${ref.adapter}/${ref.id}`;
}

function formatBindCommand(ref: BindableEndpointRef, role?: PipelineRole): string {
  const roleSuffix = role ? ` ${role}` : ' <pipelineRole>';
  return `/collab bind ${ref.adapter} ${ref.id}${roleSuffix}`;
}

function availablePipelineRoles(cell: CollaborationCell): PipelineRole[] {
  const taken = new Set(
    cell.members.map((m) => m.pipelineRole).filter((r): r is PipelineRole => !!r),
  );
  return PIPELINE_ROLES.filter((r) => !taken.has(r));
}

function formatAdapterBindPrompt(cell: CollaborationCell): string {
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
  cell: CollaborationCell,
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
  cell: CollaborationCell,
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

function formatMemberEndpointLabel(cell: CollaborationCell, member: CollaborationCell['members'][number]): string {
  const adapter = memberTransportAdapter(cell, member);
  return adapter === cell.adapter ? member.endpointId : `${adapter}/${member.endpointId}`;
}

function parseBindArgs(
  cell: CollaborationCell,
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

export function defaultCellId(adapter: string, sceneId: string): string {
  const slug = `${adapter}-${sceneId}`.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').slice(0, 80);
  return slug || `${adapter}-cell`;
}

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


function formatMemberLine(cell: CollaborationCell): string {
  return cell.members
    .map((m) => {
      const role = m.pipelineRole ?? m.primary;
      return `  • ${formatMemberEndpointLabel(cell, m)} (${role})`;
    })
    .join('\n');
}

function formatStatus(cell: CollaborationCell): string {
  const pipeline = cell.pipelineState;
  const lines = [
    `协作群 ${cell.id}`,
    `  adapter: ${cell.adapter}`,
    `  scene: ${cell.sceneId}`,
    `  goal: ${cell.goal?.trim() || '(未设置)'}`,
    `  members (${cell.members.length}):`,
    formatMemberLine(cell) || '  (无成员 — 使用 /collab bind)',
  ];
  if (pipeline) {
    lines.push(
      `  pipeline: ${pipeline.stage} (run ${pipeline.runId.slice(0, 8)}…)`,
      `  delegations: ${pipeline.activeDelegations?.length ?? 0}`,
    );
  } else {
    lines.push('  pipeline: (未初始化 — @规划员 启动任务或 /collab reset)');
  }
  return lines.join('\n');
}

function collabAdminBlocked(message: Message): boolean {
  const root = getHostRootPlugin();
  if (!root) return true;
  const gate = checkCollabAdminGate(message, String(message.$endpoint), root);
  return !gate.allowed;
}

export async function handleCollabStatus(message: Message): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `ℹ️ ${scene.error}`;
  if (collabAdminBlocked(message)) return '';
  const svc = getCollaborationCellService();
  await svc.reloadFromRepository();
  const cell = findCellForMessage(svc.listCells(), scene.adapter, scene.sceneId);
  if (!cell) {
    return [
      '当前群尚未注册为协作 Cell。',
      '用法：/collab init [协作目标]',
      '      /collab bind <endpoint> <pipelineRole>',
    ].join('\n');
  }
  return formatStatus(cell);
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

  const svc = getCollaborationCellService();
  await svc.reloadFromRepository();
  const cell = findCellForMessage(svc.listCells(), scene.adapter, scene.sceneId);
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

  const svc = getCollaborationCellService();
  await svc.reloadFromRepository();
  let cell = findCellForMessage(svc.listCells(), scene.adapter, scene.sceneId);
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

  cell = (await svc.getCellFresh(cell.id)) ?? cell;
  await rebootstrapEndpointRuntimes();
  const label = transportAdapter === cell.adapter
    ? endpointId
    : `${transportAdapter}/${endpointId}`;
  return `✅ 已绑定 ${label} → ${pipelineRoleRaw}\n${formatStatus(cell)}`;
}

export async function handleCollabUnbind(message: Message, endpointRef: string): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `⚠️ ${scene.error}`;
  if (collabAdminBlocked(message)) return '';

  const svc = getCollaborationCellService();
  await svc.reloadFromRepository();
  const cell = findCellForMessage(svc.listCells(), scene.adapter, scene.sceneId);
  if (!cell) return '⚠️ 当前群未注册协作 Cell。';

  const ref = endpointRef.trim();
  const endpointId = resolvePeerEndpointInCell(cell, ref) ?? ref;
  const ok = await svc.removeMember(cell.id, endpointId);
  if (!ok) return `⚠️ 未找到成员 ${endpointId}`;

  const fresh = (await svc.getCellFresh(cell.id)) ?? cell;
  await rebootstrapEndpointRuntimes();
  return `✅ 已移除 ${endpointId}\n${formatStatus(fresh)}`;
}

export async function handleCollabReset(message: Message, force = true): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `⚠️ ${scene.error}`;
  if (collabAdminBlocked(message)) return '';

  const svc = getCollaborationCellService();
  await svc.reloadFromRepository();
  const cell = findCellForMessage(svc.listCells(), scene.adapter, scene.sceneId);
  if (!cell) return '⚠️ 当前群未注册协作 Cell。请先 /collab init';

  if (!cell.pipelineState) {
    return `ℹ️ 协作群已注册，pipeline 尚未启动。\n${formatStatus(cell)}`;
  }

  const result = await getPipelineService().resetRun(cell.id, { force });
  if (!result.ok) return `⚠️ 重置失败：${result.error}`;

  const fresh = (await svc.getCellFresh(cell.id)) ?? cell;
  return `✅ 已重置 pipeline（run ${result.previousRunId?.slice(0, 8) ?? '?'} → ${result.state.runId.slice(0, 8)}）\n${formatStatus(fresh)}`;
}

/**
 * /collab init @Planner — 启动 init 向导。
 * 被 @ 的 Bot 成为 Planner，开始程序化逐步提问。
 */
export async function handleCollabInitWizard(
  message: Message,
  plannerAtId: string,
): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `⚠️ ${scene.error}`;

  const root = getHostRootPlugin();
  if (!root) return '⚠️ 系统未就绪。';

  const gate = checkCollabAdminGate(message, String(message.$endpoint), root);
  if (!gate.allowed) return '';

  const endpointId = String(message.$endpoint);
  const registeredMap = buildRegisteredEndpointMap(root);
  const plannerRef = registeredMap.get(plannerAtId);

  if (!plannerRef) {
    return `⚠️ 被 @ 的 Bot（${plannerAtId}）不是已注册的系统 Endpoint。`;
  }

  if (plannerRef.endpointId !== endpointId) {
    return '';
  }

  const result = await startInitWizard({
    plannerEndpointId: plannerRef.endpointId,
    plannerAdapter: scene.adapter,
    plannerSceneId: scene.sceneId,
  });

  if (!result.ok) return `⚠️ ${result.error}`;
  return result.prompt ?? '✅ Init 向导已启动。';
}

/**
 * /collab inited — 结束向导，Planner 汇聚观测并激活 Cell。
 */
export async function handleCollabInited(
  message: Message,
  plannerPrimary?: string,
): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `⚠️ ${scene.error}`;

  const root = getHostRootPlugin();
  if (!root) return '⚠️ 系统未就绪。';

  const gate = checkCollabAdminGate(message, String(message.$endpoint), root);
  if (!gate.allowed) return '';

  const sceneSvc = getSceneIdentityService();
  const session = await sceneSvc.getActiveInitSession(scene.adapter, scene.sceneId);
  if (!session) {
    return '⚠️ 当前群没有进行中的 init 向导。请先 /collab init @Planner';
  }

  const endpointId = String(message.$endpoint);
  if (session.plannerEndpointId !== endpointId) {
    return '';
  }

  const registeredMap = buildRegisteredEndpointMap(root);
  const result = await aggregateAndActivate(
    session,
    registeredMap,
    plannerPrimary || 'planner',
  );

  if (!result.ok) {
    return '⚠️ 汇聚失败。';
  }

  const lines = [
    `✅ 协作群已激活（${result.memberCount} 个成员，${result.sceneCount} 个场景别名）`,
  ];
  if (result.warnings.length > 0) {
    lines.push(...result.warnings.map((w) => `⚠️ ${w}`));
  }
  if (result.cell) {
    lines.push(formatStatus(result.cell));
  }
  return lines.join('\n');
}

/**
 * /collab init-cancel — 取消进行中的 init 向导。
 */
export async function handleCollabInitCancel(
  message: Message,
): Promise<string> {
  const scene = resolveSceneFromMessage(message);
  if (!scene.ok) return `⚠️ ${scene.error}`;

  const root = getHostRootPlugin();
  if (root) {
    const gate = checkCollabAdminGate(message, String(message.$endpoint), root);
    if (!gate.allowed) return '';
  }

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
