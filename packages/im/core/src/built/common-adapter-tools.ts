/**
 * Scene Management — 方法规范与 Tool 工厂
 *
 * 设计理念：
 *   各 IM 平台在适配器内自行实现场景治理方法（removeMember、muteMember 等），
 *   并自行注册 Tool；平台说明使用包内 `skills/<adapter>/SKILL.md`。
 *
 * 使用方式（在各适配器 start 或注册方法中）：
 *
 *   import { createSceneManagementTools, SCENE_MANAGEMENT_SKILL_KEYWORDS, SCENE_MANAGEMENT_SKILL_TAGS } from 'zhin.js';
 *   const tools = createSceneManagementTools(this, this.name);
 *   tools.forEach(t => this.addTool(t));
 *   // 另：包内 skills/<name>/SKILL.md 供 Agent 发现
 */

import type { Tool, ToolScope } from '../types.js';
import { registerDefaultScenePlatformPermitChecker } from './platform-permit.js';

// ============================================================================
// Adapter 场景治理方法规范
// ============================================================================

/**
 * 场景治理能力接口。
 * Adapter 基类通过此接口声明方法签名，子类选择性覆写。
 */
export interface ISceneManagement {
  removeMember?(endpointId: string, sceneId: string, userId: string): Promise<any>;
  muteMember?(endpointId: string, sceneId: string, userId: string, duration?: number): Promise<any>;
  setMemberNickname?(endpointId: string, sceneId: string, userId: string, nickname: string): Promise<any>;
  setModerator?(endpointId: string, sceneId: string, userId: string, enable?: boolean): Promise<any>;
  listMembers?(endpointId: string, sceneId: string): Promise<any>;
  banMember?(endpointId: string, sceneId: string, userId: string, reason?: string): Promise<any>;
  unbanMember?(endpointId: string, sceneId: string, userId: string): Promise<any>;
  renameScene?(endpointId: string, sceneId: string, name: string): Promise<any>;
  setSceneMuted?(endpointId: string, sceneId: string, enable?: boolean): Promise<any>;
  getSceneInfo?(endpointId: string, sceneId: string): Promise<any>;
}

// ============================================================================
// 方法 → Tool 元数据映射
// ============================================================================

export interface SceneManagementMethodSpec {
  method: keyof ISceneManagement;
  toolSuffix: string;
  description: string;
  keywords: string[];
  permit?: string;
  extraParams: Record<string, { type: string; description: string; default?: any }>;
  extraRequired?: string[];
  preExecutable?: boolean;
}

export const SCENE_MANAGEMENT_METHOD_SPECS: SceneManagementMethodSpec[] = [
  {
    method: 'removeMember',
    toolSuffix: 'remove_member',
    description: '将成员移出当前 IM 场景。适用于严重违规、广告号等需要移除的场景。如果只需要用户名而没有 user_id，请先调用 list_members 查询',
    keywords: ['踢', 'kick', '移除', '踢出'],
    permit: 'scene_admin',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID（如果只有昵称，先用 list_members 查询获取）' },
    },
    extraRequired: ['user_id'],
  },
  {
    method: 'muteMember',
    toolSuffix: 'mute_member',
    description: '禁言或解除禁言群成员。适用于违规发言、刷屏、骚扰他人等需要临时限制发言的场景。duration 单位为秒，传 0 表示解除禁言。默认禁言 10 分钟(600秒)。如果只有昵称而没有 user_id，请先调用 list_members 查询',
    keywords: ['禁言', 'mute', '静音', '解除禁言', '解禁', '闭嘴'],
    permit: 'scene_admin',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID（如果只有昵称，先用 list_members 查询获取）' },
      duration: { type: 'number', description: '禁言时长(秒)，0=解除禁言，默认600(10分钟)。常用值：60=1分钟, 600=10分钟, 3600=1小时, 86400=1天', default: 600 },
    },
    extraRequired: ['user_id'],
  },
  {
    method: 'setMemberNickname',
    toolSuffix: 'set_nickname',
    description: '设置群成员的群昵称/名片。仅修改群内显示名称，不影响用户的全局昵称。如果只有昵称而没有 user_id，请先调用 list_members 查询',
    keywords: ['昵称', '名片', 'nickname', 'card', '改名片'],
    permit: 'scene_admin',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID（如果只有昵称，先用 list_members 查询获取）' },
      nickname: { type: 'string', description: '新的群昵称/名片' },
    },
    extraRequired: ['user_id', 'nickname'],
  },
  {
    method: 'setModerator',
    toolSuffix: 'set_moderator',
    description: '设置或取消场景管理员。注意：此操作通常需要场景所有者权限。enable=true 为设置管理员，enable=false 为取消管理员。如果只有昵称而没有 user_id，请先调用 list_members 查询',
    keywords: ['管理员', 'admin', '设置管理', '取消管理', '提升管理', '撤销管理'],
    permit: 'scene_owner',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID（如果只有昵称，先用 list_members 查询获取）' },
      enable: { type: 'boolean', description: 'true=设置为管理员，false=取消管理员身份', default: true },
    },
    extraRequired: ['user_id'],
  },
  {
    method: 'listMembers',
    toolSuffix: 'list_members',
    description: '获取群/服务器成员列表。返回所有成员的 ID、昵称、名片、角色等信息。当用户提供昵称/名片而非 ID 时，应先调用此工具查询成员列表，从中匹配到目标用户的 user_id，再执行禁言、踢人等操作',
    keywords: ['成员', '列表', 'members', 'list', '查找', '搜索用户'],
    extraParams: {},
    preExecutable: true,
  },
  {
    method: 'banMember',
    toolSuffix: 'ban_member',
    description: '永久封禁成员（拉入黑名单）。与踢人(kick)不同，封禁后该成员无法再加入群聊。适用于恶意用户、严重违规等需要永久禁止的场景。如果只有昵称而没有 user_id，请先调用 list_members 查询',
    keywords: ['封禁', 'ban', '拉黑', '黑名单'],
    permit: 'scene_admin',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID（如果只有昵称，先用 list_members 查询获取）' },
      reason: { type: 'string', description: '封禁原因（将记录在封禁日志中）' },
    },
    extraRequired: ['user_id'],
  },
  {
    method: 'unbanMember',
    toolSuffix: 'unban_member',
    description: '解除封禁，将成员从黑名单中移除。解除后该成员可以重新加入群聊。如果只有昵称而没有 user_id，请先调用 list_members 查询',
    keywords: ['解封', 'unban', '解除封禁', '移出黑名单'],
    permit: 'scene_admin',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID（如果只有昵称，先用 list_members 查询获取）' },
    },
    extraRequired: ['user_id'],
  },
  {
    method: 'renameScene',
    toolSuffix: 'rename_scene',
    description: '修改 IM 场景名称。修改后所有成员立即可见新名称',
    keywords: ['群名', '改名', 'group name', '修改群名'],
    permit: 'scene_admin',
    extraParams: {
      name: { type: 'string', description: '新群名称' },
    },
    extraRequired: ['name'],
  },
  {
    method: 'setSceneMuted',
    toolSuffix: 'set_scene_muted',
    description: '开启或关闭场景全员禁言。开启后除管理员外所有成员都无法发言。适用于紧急维护、重要通知、聊天秩序混乱等场景。enable=true 开启，enable=false 解除',
    keywords: ['全员禁言', 'mute all', '全体禁言', '全体解禁'],
    permit: 'scene_admin',
    extraParams: {
      enable: { type: 'boolean', description: 'true=开启全员禁言，false=解除全员禁言', default: true },
    },
  },
  {
    method: 'getSceneInfo',
    toolSuffix: 'get_scene_info',
    description: '获取 IM 场景基本信息，包括名称、所有者、成员数量、创建时间等。用于了解场景概况',
    keywords: ['群信息', 'group info', '群资料', '群详情'],
    extraParams: {},
    preExecutable: true,
  },
];

// ============================================================================
// Skill 常量（群管相关 SKILL.md 与文档可复用 keywords/tags）
// ============================================================================

export const SCENE_MANAGEMENT_SKILL_TAGS = ['scene', 'management', 'im', 'admin'];
export const SCENE_MANAGEMENT_SKILL_KEYWORDS = [
  '场景治理', '群管理', '踢人', '禁言', '封禁', '管理员', '群名',
  '成员', 'kick', 'mute', 'ban', 'admin', 'members',
];

// ============================================================================
// 工厂：根据已实现的方法为指定适配器生成场景治理 Tool 列表（各平台自行调用并 addTool）
// ============================================================================

export interface SceneManagementToolFactory<T> {
  (spec: SceneManagementMethodSpec, prefix: string, execute: (args: Record<string, any>) => Promise<any>): T;
}

export function defaultScenePermitResolver(adapterPrefix: string): (logicalPerm: string) => string {
  return (logicalPerm) => `platform(${adapterPrefix},${logicalPerm})`;
}

export interface CreateSceneManagementToolsOptions {
  /** 将 SCENE_MANAGEMENT_METHOD_SPECS 逻辑 perm（scene_admin/scene_owner）映射为 platform(...) 字符串 */
  permitResolver?: (logicalPerm: string) => string | undefined;
  /** 是否注册默认 QQ 系 scene checker（默认 true） */
  registerChecker?: boolean;
}

function resolveSpecPermit(
  specPerm: string | undefined,
  prefix: string,
  permitResolver: (logicalPerm: string) => string | undefined,
): string[] | undefined {
  if (!specPerm) return undefined;
  const resolved = permitResolver(specPerm);
  return resolved ? [resolved] : undefined;
}

export function createSceneManagementTools(
  adapter: ISceneManagement,
  prefix: string,
  options: CreateSceneManagementToolsOptions = {},
): Tool[] {
  const permitResolver = options.permitResolver ?? defaultScenePermitResolver(prefix);
  if (options.registerChecker !== false) {
    registerDefaultScenePlatformPermitChecker(prefix);
  }
  return createSceneManagementToolsRaw<Tool>(adapter, prefix, (spec, prefix, execute) => {
    const specPermissions = resolveSpecPermit(spec.permit, prefix, permitResolver);
    return {
      name: `${prefix}_${spec.toolSuffix}`,
      description: `${spec.description} (${prefix})`,
      parameters: {
        type: 'object' as const,
        properties: {
          endpoint_id: { type: 'string', description: 'Endpoint ID', contextKey: 'endpointId' },
          scene_id: { type: 'string', description: 'IM 场景 ID', contextKey: 'sceneId' },
          ...Object.fromEntries(Object.entries(spec.extraParams)),
        },
        required: ['endpoint_id', 'scene_id', ...(spec.extraRequired ?? [])],
      },
      execute,
      tags: ['scene', 'management', prefix],
      keywords: spec.keywords,
      ...(specPermissions ? { permissions: specPermissions } : {}),
      scopes: ['group', 'channel'] as ToolScope[],
      preExecutable: spec.preExecutable,
    };
  });
}

export function createSceneManagementToolsRaw<T>(
  adapter: ISceneManagement,
  prefix: string,
  factory: SceneManagementToolFactory<T>,
): T[] {
  const tools: T[] = [];
  for (const spec of SCENE_MANAGEMENT_METHOD_SPECS) {
    const fn = adapter[spec.method];
    if (typeof fn !== 'function') continue;

    const boundFn = fn.bind(adapter);
    const execute = async (args: Record<string, any>) => {
      const { endpoint_id, scene_id, ...rest } = args;
      const methodArgs = buildSceneMethodArgs(spec.method, endpoint_id, scene_id, rest);
      return (boundFn as (...a: any[]) => Promise<any>).apply(adapter, methodArgs);
    };

    tools.push(factory(spec, prefix, execute));
  }
  return tools;
}

// ============================================================================
// 参数映射（method → 有序参数列表）
// ============================================================================

export function buildSceneMethodArgs(
  method: keyof ISceneManagement,
  endpointId: string,
  sceneId: string,
  rest: Record<string, any>,
): any[] {
  switch (method) {
    case 'removeMember':    return [endpointId, sceneId, rest.user_id];
    case 'muteMember':      return [endpointId, sceneId, rest.user_id, rest.duration ?? 600];
    case 'setMemberNickname': return [endpointId, sceneId, rest.user_id, rest.nickname];
    case 'setModerator':    return [endpointId, sceneId, rest.user_id, rest.enable ?? true];
    case 'listMembers':     return [endpointId, sceneId];
    case 'banMember':       return [endpointId, sceneId, rest.user_id, rest.reason];
    case 'unbanMember':     return [endpointId, sceneId, rest.user_id];
    case 'renameScene':     return [endpointId, sceneId, rest.name];
    case 'setSceneMuted':   return [endpointId, sceneId, rest.enable ?? true];
    case 'getSceneInfo':    return [endpointId, sceneId];
    default:                return [endpointId, sceneId, ...(Object.values(rest) as any[])];
  }
}
