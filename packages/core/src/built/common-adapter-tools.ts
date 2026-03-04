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
    description: '将成员踢出群/服务器。适用于严重违规、广告号等需要移除的场景。踢出后该成员将无法再进入群聊（部分平台可重新邀请）。如果只需要用户名而没有 user_id，请先调用 list_members 查询',
    keywords: ['踢', 'kick', '移除', '踢出'],
    permissionLevel: 'group_admin',
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
    permissionLevel: 'group_admin',
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
    permissionLevel: 'group_admin',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID（如果只有昵称，先用 list_members 查询获取）' },
      nickname: { type: 'string', description: '新的群昵称/名片' },
    },
    extraRequired: ['user_id', 'nickname'],
  },
  {
    method: 'setAdmin',
    toolSuffix: 'set_admin',
    description: '设置或取消群管理员。注意：此操作需要群主权限，普通管理员无法执行。enable=true 为设置管理员，enable=false 为取消管理员。如果只有昵称而没有 user_id，请先调用 list_members 查询',
    keywords: ['管理员', 'admin', '设置管理', '取消管理', '提升管理', '撤销管理'],
    permissionLevel: 'group_owner',
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
    permissionLevel: 'user',
    extraParams: {},
    preExecutable: true,
  },
  {
    method: 'banMember',
    toolSuffix: 'ban_member',
    description: '永久封禁成员（拉入黑名单）。与踢人(kick)不同，封禁后该成员无法再加入群聊。适用于恶意用户、严重违规等需要永久禁止的场景。如果只有昵称而没有 user_id，请先调用 list_members 查询',
    keywords: ['封禁', 'ban', '拉黑', '黑名单'],
    permissionLevel: 'group_admin',
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
    permissionLevel: 'group_admin',
    extraParams: {
      user_id: { type: 'string', description: '目标用户 ID（如果只有昵称，先用 list_members 查询获取）' },
    },
    extraRequired: ['user_id'],
  },
  {
    method: 'setGroupName',
    toolSuffix: 'set_group_name',
    description: '修改群/服务器名称。修改后所有成员立即可见新群名',
    keywords: ['群名', '改名', 'group name', '修改群名'],
    permissionLevel: 'group_admin',
    extraParams: {
      name: { type: 'string', description: '新群名称' },
    },
    extraRequired: ['name'],
  },
  {
    method: 'muteAll',
    toolSuffix: 'mute_all',
    description: '开启或关闭全员禁言。开启后除管理员外所有成员都无法发言。适用于紧急维护、重要通知、聊天秩序混乱等场景。enable=true 开启，enable=false 解除',
    keywords: ['全员禁言', 'mute all', '全体禁言', '全体解禁'],
    permissionLevel: 'group_admin',
    extraParams: {
      enable: { type: 'boolean', description: 'true=开启全员禁言，false=解除全员禁言', default: true },
    },
  },
  {
    method: 'getGroupInfo',
    toolSuffix: 'get_group_info',
    description: '获取群/服务器基本信息，包括群名、群主、成员数量、创建时间等。用于了解群聊概况',
    keywords: ['群信息', 'group info', '群资料', '群详情'],
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
  '设置管理员、修改群名、查看成员列表等操作。具体可用的操作取决于平台和 Bot 权限。\n\n' +
  '使用指南：\n' +
  '1. 用户提供昵称/名片而非 ID 时，必须先调用 list_members 查询成员列表，从返回结果中匹配目标用户的 user_id，再执行后续操作\n' +
  '2. 禁言(mute_member)适用场景：违规发言、刷屏、骚扰他人等；传 duration=0 可解除禁言\n' +
  '3. 设置/取消管理员(set_admin)需要群主权限，普通管理员无法操作；enable=false 为取消管理员\n' +
  '4. 踢人(kick_member)是将成员移出群聊，封禁(ban_member)是永久拉黑，两者不同\n' +
  '5. 操作前应确认目标用户正确，避免误操作';

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
