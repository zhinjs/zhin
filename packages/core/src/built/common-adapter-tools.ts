/**
 * Group Management Skill — 方法规范与元数据
 *
 * 设计理念：
 *   群管理是 IM 系统的一种"技能"(Skill)，而非一组零散的工具。
 *   Adapter 基类声明群管理操作的方法规范（可选），
 *   具体适配器（ICQQ/Discord/Telegram 等）选择性覆写。
 *   Adapter.start() 自动检测哪些方法已被子类实现，
 *   生成对应的 Tool 并注册为 "群聊管理" Skill。
 *
 * 子类无需任何额外调用：
 *
 *   class IcqqAdapter extends Adapter<IcqqBot> {
 *     async kickMember(botId, sceneId, userId) { ... }
 *     async muteMember(botId, sceneId, userId, duration) { ... }
 *     // start() 中自动检测 → 自动注册 Skill，零样板代码
 *   }
 */

import type { ToolPermissionLevel } from '../types.js';

// ============================================================================
// Adapter 群管理方法规范
// ============================================================================

/**
 * 群管理能力接口。
 * Adapter 基类通过此接口声明方法签名，子类选择性覆写。
 */
export interface IGroupManagement {
  kickMember?(botId: string, sceneId: string, userId: string): Promise<any>;
  muteMember?(botId: string, sceneId: string, userId: string, duration?: number): Promise<any>;
  setMemberNickname?(botId: string, sceneId: string, userId: string, nickname: string): Promise<any>;
  setAdmin?(botId: string, sceneId: string, userId: string, enable?: boolean): Promise<any>;
  listMembers?(botId: string, sceneId: string): Promise<any>;
  banMember?(botId: string, sceneId: string, userId: string, reason?: string): Promise<any>;
  unbanMember?(botId: string, sceneId: string, userId: string): Promise<any>;
  setGroupName?(botId: string, sceneId: string, name: string): Promise<any>;
  muteAll?(botId: string, sceneId: string, enable?: boolean): Promise<any>;
  getGroupInfo?(botId: string, sceneId: string): Promise<any>;
}

// ============================================================================
// 方法 → Tool 元数据映射
// ============================================================================

export interface GroupMethodSpec {
  method: keyof IGroupManagement;
  toolSuffix: string;
  description: string;
  keywords: string[];
  permissionLevel: ToolPermissionLevel;
  extraParams: Record<string, { type: string; description: string; default?: any }>;
  extraRequired?: string[];
  preExecutable?: boolean;
}

export const GROUP_METHOD_SPECS: GroupMethodSpec[] = [
  {
    method: 'kickMember',
    toolSuffix: 'kick_member',
    description: '将成员踢出群/服务器',
    keywords: ['踢', 'kick', '移除', '踢出'],
    permissionLevel: 'group_admin',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID' },
    },
    extraRequired: ['user_id'],
  },
  {
    method: 'muteMember',
    toolSuffix: 'mute_member',
    description: '禁言群成员（duration=0 解除）',
    keywords: ['禁言', 'mute', '静音', '解除禁言'],
    permissionLevel: 'group_admin',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID' },
      duration: { type: 'number', description: '禁言时长(秒)，0=解除', default: 600 },
    },
    extraRequired: ['user_id'],
  },
  {
    method: 'setMemberNickname',
    toolSuffix: 'set_nickname',
    description: '设置群成员昵称/名片',
    keywords: ['昵称', '名片', 'nickname', 'card'],
    permissionLevel: 'group_admin',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID' },
      nickname: { type: 'string', description: '新昵称' },
    },
    extraRequired: ['user_id', 'nickname'],
  },
  {
    method: 'setAdmin',
    toolSuffix: 'set_admin',
    description: '设置/取消群管理员',
    keywords: ['管理员', 'admin', '设置管理'],
    permissionLevel: 'group_owner',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID' },
      enable: { type: 'boolean', description: '设置(true)/取消(false)', default: true },
    },
    extraRequired: ['user_id'],
  },
  {
    method: 'listMembers',
    toolSuffix: 'list_members',
    description: '获取群/服务器成员列表',
    keywords: ['成员', '列表', 'members', 'list'],
    permissionLevel: 'user',
    extraParams: {},
    preExecutable: true,
  },
  {
    method: 'banMember',
    toolSuffix: 'ban_member',
    description: '封禁成员',
    keywords: ['封禁', 'ban', '拉黑'],
    permissionLevel: 'group_admin',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID' },
      reason: { type: 'string', description: '封禁原因' },
    },
    extraRequired: ['user_id'],
  },
  {
    method: 'unbanMember',
    toolSuffix: 'unban_member',
    description: '解除封禁',
    keywords: ['解封', 'unban', '解除封禁'],
    permissionLevel: 'group_admin',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID' },
    },
    extraRequired: ['user_id'],
  },
  {
    method: 'setGroupName',
    toolSuffix: 'set_group_name',
    description: '修改群名称',
    keywords: ['群名', '改名', 'group name'],
    permissionLevel: 'group_admin',
    extraParams: {
      name: { type: 'string', description: '新群名' },
    },
    extraRequired: ['name'],
  },
  {
    method: 'muteAll',
    toolSuffix: 'mute_all',
    description: '全员禁言/解除全员禁言',
    keywords: ['全员禁言', 'mute all', '全体禁言'],
    permissionLevel: 'group_admin',
    extraParams: {
      enable: { type: 'boolean', description: '开启(true)/解除(false)', default: true },
    },
  },
  {
    method: 'getGroupInfo',
    toolSuffix: 'get_group_info',
    description: '获取群/服务器基本信息',
    keywords: ['群信息', 'group info', '群资料'],
    permissionLevel: 'user',
    extraParams: {},
    preExecutable: true,
  },
];

// ============================================================================
// Skill 常量
// ============================================================================

export const GROUP_MANAGEMENT_SKILL_DESCRIPTION =
  '群聊管理能力：在 IM 系统中对群/服务器进行管理，包括踢人、禁言、封禁、' +
  '设置管理员、修改群名、查看成员列表等操作。具体可用的操作取决于平台和 Bot 权限。';

export const GROUP_MANAGEMENT_SKILL_TAGS = ['group', 'management', 'im', 'admin'];
export const GROUP_MANAGEMENT_SKILL_KEYWORDS = [
  '群管理', '踢人', '禁言', '封禁', '管理员', '群名',
  '成员', 'kick', 'mute', 'ban', 'admin', 'members',
];

// ============================================================================
// 参数映射（method → 有序参数列表）
// ============================================================================

export function buildMethodArgs(
  method: keyof IGroupManagement,
  botId: string,
  sceneId: string,
  rest: Record<string, any>,
): any[] {
  switch (method) {
    case 'kickMember':      return [botId, sceneId, rest.user_id];
    case 'muteMember':      return [botId, sceneId, rest.user_id, rest.duration ?? 600];
    case 'setMemberNickname': return [botId, sceneId, rest.user_id, rest.nickname];
    case 'setAdmin':        return [botId, sceneId, rest.user_id, rest.enable ?? true];
    case 'listMembers':     return [botId, sceneId];
    case 'banMember':       return [botId, sceneId, rest.user_id, rest.reason];
    case 'unbanMember':     return [botId, sceneId, rest.user_id];
    case 'setGroupName':    return [botId, sceneId, rest.name];
    case 'muteAll':         return [botId, sceneId, rest.enable ?? true];
    case 'getGroupInfo':    return [botId, sceneId];
    default:                return [botId, sceneId, ...Object.values(rest)];
  }
}
