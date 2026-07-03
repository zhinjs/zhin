/**
 * InitObservationHook — waiting 态 endpoint 被动记录 master @ 事件。
 *
 * 在 init 向导阶段，所有 collaboration.enabled 的 endpoint 观测入站消息：
 * 若消息含 at segment 且指向已注册的系统 Bot → 写 init_observation。
 * Planner 在 advance 时读取 observations 推进步骤。
 */

import type { Message, Plugin } from '@zhin.js/core';
import { getSceneIdentityService } from './scene-identity-service.js';
import { advanceWizardStep } from './init-wizard-service.js';
import { isAssignableWizardRole, type WizardStep } from './collaboration-db-model.js';

/**
 * 从 at 消息段提取平台 id（兼容 qq / user_id / id）。
 */
export function atSegmentPlatformId(
  data: Record<string, unknown> | undefined,
): string | undefined {
  if (!data) return undefined;
  for (const key of ['qq', 'user_id', 'id'] as const) {
    const value = data[key];
    if (value != null && String(value).trim() !== '') {
      return String(value);
    }
  }
  return undefined;
}

/**
 * 提取消息中 at segment 的 target id 列表。
 */
export function extractAtTargets(message: Message): string[] {
  const targets: string[] = [];
  for (const el of message.$content ?? []) {
    if (el.type !== 'at') continue;
    const id = atSegmentPlatformId(el.data as Record<string, unknown> | undefined);
    if (id) targets.push(id);
  }
  return targets;
}

/**
 * 判断当前 endpoint 是否是已注册的系统 Bot。
 */
export function isRegisteredEndpoint(
  root: Plugin,
  platformId: string,
): { adapter: string; endpointId: string } | undefined {
  for (const adapterName of root.adapters) {
    const name = String(adapterName);
    try {
      const adapter = root.inject(name) as
        | { endpoints?: Map<string, { $config?: Record<string, unknown>; $platformUserId?: string }> }
        | undefined;
      if (!adapter?.endpoints) continue;
      for (const [epId, ep] of adapter.endpoints) {
        const ids = new Set([epId]);
        if (ep.$config?.name) ids.add(String(ep.$config.name));
        if (ep.$config?.appid) ids.add(String(ep.$config.appid));
        if (ep.$platformUserId) ids.add(String(ep.$platformUserId));
        if (ids.has(platformId)) {
          return { adapter: name, endpointId: epId };
        }
      }
    } catch {
      // adapter not ready
    }
  }
  return undefined;
}

/**
 * 列出所有已注册的系统 Bot 的 (platformId → adapter, endpointId) 映射。
 */
export function buildRegisteredEndpointMap(
  root: Plugin,
): Map<string, { adapter: string; endpointId: string }> {
  const map = new Map<string, { adapter: string; endpointId: string }>();
  for (const adapterName of root.adapters) {
    const name = String(adapterName);
    try {
      const adapter = root.inject(name) as
        | { endpoints?: Map<string, { $config?: Record<string, unknown>; $platformUserId?: string }> }
        | undefined;
      if (!adapter?.endpoints) continue;
      for (const [epId, ep] of adapter.endpoints) {
        const ref = { adapter: name, endpointId: epId };
        map.set(epId, ref);
        if (ep.$config?.name) map.set(String(ep.$config.name), ref);
        if (ep.$config?.appid) map.set(String(ep.$config.appid), ref);
        if (ep.$platformUserId) map.set(String(ep.$platformUserId), ref);
      }
    } catch {
      // adapter not ready
    }
  }
  return map;
}

export interface ObserveAtResult {
  observed: boolean;
  advanceResult?: { nextPrompt: string; done: boolean; advanced: boolean };
}

/** Planner 对同一入站消息只推进一次（防并发双跳步）。 */
const plannerAdvanceByMessage = new Map<string, string>();

export type InitWizardInboundGateResult =
  | { action: 'continue' }
  | { action: 'block'; replied?: boolean };

/**
 * init 向导收集阶段入站门控：
 * - 非 Planner bot：只 stash，不搭话（block）
 * - Planner：@ 分配角色后回复下一步 prompt（block）
 * - /collab 命令：放行给 command 分支（continue）
 */
export async function handleInitWizardInboundGate(
  message: Message,
  endpointId: string,
  root: Plugin,
): Promise<InitWizardInboundGateResult> {
  const adapter = String(message.$adapter ?? '');
  const sceneId = String(message.$channel?.id ?? '');
  if (!adapter || !sceneId) return { action: 'continue' };

  const sceneSvc = getSceneIdentityService();
  const session = await sceneSvc.findActiveInitSessionForInbound(adapter, sceneId);
  if (!session) return { action: 'continue' };

  const text = (message.$content ?? [])
    .map((seg) => (seg.type === 'text' ? String(seg.data?.text ?? '') : ''))
    .join('')
    .trim();
  if (text.startsWith('/collab')) return { action: 'continue' };

  const isPlanner = endpointId === session.plannerEndpointId;
  const result = await observeAtForInitWizard(message, endpointId, root);

  if (isPlanner && result.advanceResult && message.$reply) {
    await message.$reply(result.advanceResult.nextPrompt);
    return { action: 'block', replied: true };
  }

  if (result.observed || !isPlanner) {
    return { action: 'block' };
  }

  return { action: 'continue' };
}

/**
 * 入站消息观测：若当前有 active init session 且消息含 @ 到系统 Bot → 写 observation。
 *
 * 由 Planner endpoint 调用 advanceWizardStep 推进步骤；
 * 非 Planner endpoint 仅记录 observation。
 */
export async function observeAtForInitWizard(
  message: Message,
  endpointId: string,
  root: Plugin,
): Promise<ObserveAtResult> {
  const adapter = String(message.$adapter ?? '');
  const sceneId = String(message.$channel?.id ?? '');
  if (!adapter || !sceneId) return { observed: false };

  const sceneSvc = getSceneIdentityService();

  const session = await sceneSvc.findActiveInitSessionForInbound(adapter, sceneId);
  if (!session) return { observed: false };

  const atTargets = extractAtTargets(message);
  if (atTargets.length === 0) return { observed: false };

  const registeredMap = buildRegisteredEndpointMap(root);
  let roleAssigneeMatched = false;
  let matchedAny = false;
  const currentStep = (session.wizardStep || 'researcher') as WizardStep;
  if (!isAssignableWizardRole(currentStep)) {
    return { observed: false };
  }

  for (const target of atTargets) {
    const resolved = registeredMap.get(target);
    if (!resolved) continue;
    if (resolved.endpointId === session.plannerEndpointId) continue;

    await sceneSvc.addObservation({
      sessionId: session.id,
      observerEndpointId: endpointId,
      observerAdapter: adapter,
      observerSceneId: sceneId,
      atTargetPlatformId: target,
      wizardStep: currentStep,
    });
    matchedAny = true;
    roleAssigneeMatched = true;
  }

  if (!matchedAny) return { observed: false };

  if (endpointId === session.plannerEndpointId && roleAssigneeMatched) {
    const messageId = String(message.$id ?? '');
    if (messageId && plannerAdvanceByMessage.get(session.id) === messageId) {
      return { observed: true };
    }

    const result = await advanceWizardStep(session, currentStep);
    if (result.advanced && messageId) {
      plannerAdvanceByMessage.set(session.id, messageId);
    }
    if (result.advanced) {
      return { observed: true, advanceResult: result };
    }
    return { observed: true };
  }

  return { observed: true };
}
