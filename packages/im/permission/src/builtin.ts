/**
 * 内置 permit DSL（ADR 0056 §5）。数组 AND；单项括号内逗号 OR。
 *
 * - 会话：`adapter(…)` / `group(…)` / `private(…)` / `channel(…)` / `user(…)`
 * - zhin 聊天角色（按当前会话的层级链计算，`owner` ⊃ `admin` ⊃ `trusted`）：
 *   `owner` / `admin` / `trusted`，或 `role(owner,admin,…)`；
 *   层级限定 `<角色>@<层级>`（`owner@global`、`owner@adapter`、`admin@endpoint`……，也可写在 `role(…)` 里）：
 *   发言者须在当前会话链上「该层级或更高层级」的作用范围持有该角色（宿主全局能力用 `owner@global`）
 * - 发言者的平台身份（管平台功能）：`platform:owner` / `platform:admin`（归一地位；`admin` 也接受群主）、
 *   `platform-role:<id>`、`platform-permission:<name>`
 * - 机器人账号自身在本会话的平台身份（平台操作需要机器人有权限时）：`bot:owner` / `bot:admin`、
 *   `bot-role:<id>`、`bot-permission:<name>`；机器人身份未知（未声明 `scene.selfStanding` 或查询失败）时不满足
 *
 * 三条维度互不换算（平台群主不是 zhin `admin`），命令的 `permit` 与 Agent 工具 / 技能的 `permissions`
 * 共用本评估器。
 *
 * 已移除（构建期报错并给出替代）：`role(master)`、`role(user)`、`scene_admin`、`scene_owner`、
 * `platform(adapter,perm)`。
 */

import type { PermissionSubject } from './subject.js';

export type PermitKind =
  | 'adapter' | 'group' | 'private' | 'channel' | 'user' | 'role'
  | 'platform' | 'platform-role' | 'platform-permission'
  | 'bot' | 'bot-role' | 'bot-permission';

/** Permit kinds that read the receiving account's own standing (`subject.bot`). */
export const BOT_PERMIT_KINDS: ReadonlySet<PermitKind> = new Set<PermitKind>(['bot', 'bot-role', 'bot-permission']);

export interface ParsedPermit {
  readonly kind: PermitKind;
  readonly values: readonly string[];
}

export type PermitChatRole = 'owner' | 'admin' | 'trusted';
const CHAT_ROLE_RANK: Readonly<Record<PermitChatRole, number>> = Object.freeze({ trusted: 1, admin: 2, owner: 3 });
const isPermitChatRole = (value: string): value is PermitChatRole => value === 'owner' || value === 'admin' || value === 'trusted';
export type PermitChatRoleLevel = 'global' | 'adapter' | 'endpoint' | 'conversation';
const PERMIT_LEVELS: readonly PermitChatRoleLevel[] = Object.freeze(['global', 'adapter', 'endpoint', 'conversation']);

/** `owner` or `owner@global` → `{ role, level }`; undefined when malformed. */
function parseRoleRequirement(value: string): { role: PermitChatRole; level: PermitChatRoleLevel } | undefined {
  const at = value.indexOf('@');
  const role = at < 0 ? value : value.slice(0, at);
  const level = at < 0 ? 'conversation' : value.slice(at + 1);
  if (!isPermitChatRole(role) || !(PERMIT_LEVELS as readonly string[]).includes(level)) return undefined;
  return { role, level: level as PermitChatRoleLevel };
}

const CALL_RE = /^(adapter|group|private|channel|user|role)\(([^)]*)\)$/u;
const PLATFORM_RE = /^(platform|platform-role|platform-permission|bot|bot-role|bot-permission):(.+)$/u;
const LEGACY_PLATFORM_RE = /^platform\(([^)]*)\)$/u;

function splitValues(inner: string): readonly string[] {
  const values = inner.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
  return values.length > 0 ? values : [''];
}

export function parsePermitName(name: string): ParsedPermit | null {
  if (typeof name !== 'string') return null;
  if (parseRoleRequirement(name)) return { kind: 'role', values: [name] };
  const call = name.match(CALL_RE);
  if (call) {
    const kind = call[1] as PermitKind;
    const inner = call[2]!.trim();
    const values = inner ? splitValues(inner) : [''];
    if (kind === 'role' && !values.every((value) => parseRoleRequirement(value) !== undefined)) return null;
    return { kind, values };
  }
  const platform = name.match(PLATFORM_RE);
  if (platform) {
    const kind = platform[1] as PermitKind;
    const value = platform[2]!.trim();
    if (!value) return null;
    if ((kind === 'platform' || kind === 'bot') && value !== 'owner' && value !== 'admin') return null;
    return { kind, values: [value] };
  }
  return null;
}

export function isBuiltinPermit(name: string): boolean {
  return parsePermitName(name) !== null;
}

/** Whether any permit needs the receiving account's own standing (`bot:*`). */
export function permitsNeedBotStanding(permits: readonly string[] | undefined): boolean {
  return (permits ?? []).some((name) => {
    const parsed = parsePermitName(name);
    return !!parsed && BOT_PERMIT_KINDS.has(parsed.kind);
  });
}

/** Replacement hint for a removed permit spelling; undefined when the name is not a removed form. */
export function removedPermitReplacement(name: string): string | undefined {
  if (isBuiltinPermit(name)) return undefined;
  if (name === 'scene_admin') return 'platform:admin';
  if (name === 'scene_owner') return 'platform:owner';
  if (name === 'master') return 'owner';
  const legacy = name.match(LEGACY_PLATFORM_RE);
  if (legacy) {
    const perm = legacy[1]!.split(',').slice(1).join(',').trim();
    if (perm === 'scene_admin') return 'platform:admin';
    if (perm === 'scene_owner') return 'platform:owner';
    return `platform-permission:${perm || '<name>'}`;
  }
  const call = name.match(CALL_RE);
  if (call && call[1] === 'role') {
    const values = splitValues(call[2]!).map((value) => value === 'master' ? 'owner' : value).filter(isPermitChatRole);
    return values.length ? `role(${[...new Set(values)].join(',')})` : 'remove the rule (every sender qualifies)';
  }
  return undefined;
}

/** 构建期语法校验：只接受内置 DSL；已移除的写法给出替代。 */
export function assertPermitSyntax(permits: readonly string[], source?: string): void {
  for (const [index, name] of permits.entries()) {
    if (typeof name === 'string' && isBuiltinPermit(name)) continue;
    const where = source ? ` for ${source}` : '';
    const replacement = typeof name === 'string' ? removedPermitReplacement(name) : undefined;
    if (replacement) {
      throw new TypeError(`Permit[${index}]${where} ${JSON.stringify(name)} was removed (ADR 0056); use ${replacement}`);
    }
    throw new TypeError(
      `Unknown permit[${index}]${where}: ${JSON.stringify(name)} `
      + '(expected adapter|group|private|channel|user(...), owner|admin|trusted[@global|adapter|endpoint|conversation], role(owner|admin|trusted[@level]), '
      + 'platform:owner|admin, platform-role:<id>, platform-permission:<name>, '
        + 'bot:owner|admin, bot-role:<id> or bot-permission:<name>)',
    );
  }
}

export function checkBuiltinPermit(name: string, subject: PermissionSubject): boolean {
  const parsed = parsePermitName(name);
  if (!parsed) return false;
  const sender = subject.sender;
  const platform = sender?.platform;
  const bot = subject.bot;

  switch (parsed.kind) {
    case 'adapter':
      return parsed.values.some((v) => adapterMatches(subject.adapter, v));
    case 'group':
      return sceneMatches(subject, 'group', parsed.values);
    case 'private':
      return sceneMatches(subject, 'private', parsed.values);
    case 'channel':
      return sceneMatches(subject, 'channel', parsed.values);
    case 'user':
      return !!sender && parsed.values.some((id) => sender.id === id);
    case 'role':
      return !!sender?.chatRole && parsed.values.some((req) => chatRoleSatisfies(sender, req));
    case 'platform':
    case 'bot':
      return standingIncludes((parsed.kind === 'bot' ? bot : platform)?.standing, parsed.values[0]!);
    case 'platform-role':
    case 'bot-role':
      return ((parsed.kind === 'bot-role' ? bot : platform)?.roles ?? []).some((role) => role.id === parsed.values[0]);
    case 'platform-permission':
    case 'bot-permission':
      return ((parsed.kind === 'bot-permission' ? bot : platform)?.permissions ?? []).includes(parsed.values[0]!);
    default:
      return false;
  }
}

export function checkBuiltinPermitList(
  permits: readonly string[],
  subject: PermissionSubject,
): boolean {
  return permits.every((name) => checkBuiltinPermit(name, subject));
}

/** `owner` 只认群主；`admin` 也接受群主。 */
function standingIncludes(standing: string | undefined, required: string): boolean {
  return required === 'owner' ? standing === 'owner' : standing === 'owner' || standing === 'admin';
}

function adapterMatches(sessionAdapter: string | undefined, value: string): boolean {
  if (!sessionAdapter) return false;
  if (sessionAdapter === value) return true;
  const last = sessionAdapter.includes('/')
    ? sessionAdapter.slice(sessionAdapter.lastIndexOf('/') + 1)
    : sessionAdapter;
  return last === value || last.startsWith(`${value}-`);
}

function sceneMatches(
  subject: PermissionSubject,
  type: string,
  values: readonly string[],
): boolean {
  const scene = subject.scene;
  if (!scene || scene.type !== type) return false;
  return values.some((id) => id === '' || id === '*' || scene.id === id);
}

/**
 * `owner` ⊃ `admin` ⊃ `trusted`（与 core 聊天角色一致的轻量副本）；`<role>@<level>` 还要求该角色来自
 * 该层级或更高层级（`sender.chatRoleLevels`，缺省视为会话层，fail closed）。
 */
function chatRoleSatisfies(sender: NonNullable<PermissionSubject['sender']>, required: string): boolean {
  const held = sender.chatRole;
  const requirement = parseRoleRequirement(required);
  if (!held || !isPermitChatRole(held) || !requirement) return false;
  if (CHAT_ROLE_RANK[held] < CHAT_ROLE_RANK[requirement.role]) return false;
  if (requirement.level === 'conversation') return true;
  const from = sender.chatRoleLevels?.[requirement.role] ?? 'conversation';
  return PERMIT_LEVELS.indexOf(from) <= PERMIT_LEVELS.indexOf(requirement.level);
}
