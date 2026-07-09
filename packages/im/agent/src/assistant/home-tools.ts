/**
 * home_* 工具 — 薄封装 HomeAssistantService（M4）
 */
import { ZhinTool, type Message, getHostRootPlugin } from '@zhin.js/core';
import type { HomeAssistantService } from './domains/home-assistant.js';
import type { HomePolicyConfig } from './home-config.js';
import {
  checkHomeToolAccess,
  toHomeDenyError,
  toHomeOwnerSignal,
  type HomeToolDecision,
} from './home-policy.js';
import { resolveToolRequesterRole } from '../security/owner-approve-always-store.js';
export interface HomeToolsOptions {
  service: HomeAssistantService;
  policy: HomePolicyConfig & { requireMaster: boolean; confirmServices: string[] };
}

function guard(
  operation: 'read' | 'write',
  entityId: string,
  commMessage: Message | undefined,
  policy: HomeToolsOptions['policy'],
): string | null {
  const decision = checkHomeToolAccess(operation, entityId, commMessage, policy);
  return formatGuardResult(decision);
}

function guardMasterOnly(
  commMessage: Message | undefined,
  policy: HomeToolsOptions['policy'],
): string | null {
  if (!policy.requireMaster || !commMessage?.$adapter || !commMessage?.$endpoint || !commMessage?.$sender?.id) {
    return null;
  }
  try {
    const host = getHostRootPlugin();
    if (!host) return null;
    const role = resolveToolRequesterRole(host, commMessage);
    if (role === 'master') return null;
    return toHomeDenyError({
      allowed: false,
      role,
      reason: '智能家居操作仅允许 Endpoint Owner（master）调用。',
    });
  } catch {
    return null;
  }
}

function formatGuardResult(decision: HomeToolDecision): string | null {
  if (decision.allowed) return null;
  if (decision.needsOwnerApproval) return toHomeOwnerSignal(decision);
  return toHomeDenyError(decision);
}

export function createHomeTools(options: HomeToolsOptions): ZhinTool[] {
  const { service, policy } = options;

  const listAliases = new ZhinTool('home_list_aliases')
    .desc('列出已配置的智能家居设备别名（不暴露原始 entity_id 给用户层）')
    .keyword('智能家居', '设备列表', 'home list', '别名')
    .tag('home', 'assistant')
    .execute(async (_args, commMessage) => {
      const aliases = service.listAliases();
      const names = Object.keys(aliases);
      if (names.length === 0) return { aliases: {}, message: '未配置任何设备别名' };
      const listErr = guardMasterOnly(commMessage, policy);
      if (listErr) return { error: listErr };
      return { aliases: names, count: names.length };
    });

  const getState = new ZhinTool('home_get_state')
    .desc('读取智能家居设备状态（使用配置别名，如「客厅灯」）')
    .keyword('设备状态', '灯状态', 'home state', '查询')
    .tag('home', 'assistant')
    .param('alias', { type: 'string', description: '设备别名（zhin.config.yml assistant.home.aliases 中配置）' }, true)
    .execute(async (args, commMessage) => {
      const alias = String(args.alias ?? '').trim();
      if (!alias) return { error: 'alias 必填' };
      let entityId: string;
      try {
        entityId = service.resolveAlias(alias);
      } catch (e) {
        return { error: (e as Error).message };
      }
      const err = guard('read', entityId, commMessage, policy);
      if (err) return { error: err };
      try {
        const state = await service.getState(alias);
        return {
          alias,
          state: state.state,
          attributes: state.attributes,
          lastUpdated: state.lastUpdated,
        };
      } catch (e) {
        return { error: (e as Error).message };
      }
    });

  const turnOn = new ZhinTool('home_turn_on')
    .desc('打开/开启智能家居设备（别名，如「客厅灯」）')
    .keyword('开灯', '打开', 'home on', 'turn on')
    .tag('home', 'assistant')
    .param('alias', { type: 'string', description: '设备别名' }, true)
    .execute(async (args, commMessage) => {
      const alias = String(args.alias ?? '').trim();
      if (!alias) return { error: 'alias 必填' };
      let entityId: string;
      try {
        entityId = service.resolveAlias(alias);
      } catch (e) {
        return { error: (e as Error).message };
      }
      const err = guard('write', entityId, commMessage, policy);
      if (err) return { error: err };
      try {
        const result = await service.turnOn(alias);
        return { success: true, ...result, message: `已执行 ${result.service}` };
      } catch (e) {
        return { error: (e as Error).message };
      }
    });

  const turnOff = new ZhinTool('home_turn_off')
    .desc('关闭智能家居设备（别名，如「客厅灯」）')
    .keyword('关灯', '关闭', 'home off', 'turn off')
    .tag('home', 'assistant')
    .param('alias', { type: 'string', description: '设备别名' }, true)
    .execute(async (args, commMessage) => {
      const alias = String(args.alias ?? '').trim();
      if (!alias) return { error: 'alias 必填' };
      let entityId: string;
      try {
        entityId = service.resolveAlias(alias);
      } catch (e) {
        return { error: (e as Error).message };
      }
      const err = guard('write', entityId, commMessage, policy);
      if (err) return { error: err };
      try {
        const result = await service.turnOff(alias);
        return { success: true, ...result, message: `已执行 ${result.service}` };
      } catch (e) {
        return { error: (e as Error).message };
      }
    });

  return [listAliases, getState, turnOn, turnOff];
}
