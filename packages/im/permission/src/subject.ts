/**
 * PermissionSubject — duck-typed 鉴权主体（与 CommandSession 同构）。
 * 不依赖 `@zhin.js/core`；任何带有 adapter/endpoint/scene/sender 的对象都可投影。
 *
 * 角色只读 Runtime 设置的 `sender.chatRole` 与归一的 `sender.platform`（ADR 0056），
 * 不读 metadata 或适配器自报的字符串角色。
 */

export interface PermissionScene {
  readonly id: string;
  readonly type: string;
  readonly name?: string;
}

export interface PermissionPlatformStanding {
  readonly standing: 'owner' | 'admin' | 'member' | 'guest';
  readonly roles?: readonly Readonly<{ id: string; name?: string }>[];
  readonly permissions?: readonly string[];
}

export interface PermissionSender {
  readonly id: string;
  readonly name?: string;
  /** Highest zhin chat role effective in the conversation. */
  readonly chatRole?: 'owner' | 'admin' | 'trusted';
  /** Normalized platform standing; absent in private chats. */
  readonly platform?: PermissionPlatformStanding;
}

export interface PermissionSubject {
  readonly adapter?: string;
  readonly endpoint?: string;
  readonly scene?: PermissionScene;
  readonly sender?: PermissionSender;
  /**
   * The receiving Bot account's own platform standing in this conversation (ADR 0056 §1; `bot:*`
   * permits). Absent = unknown: every `bot:*` permit fails.
   */
  readonly bot?: PermissionPlatformStanding;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const STANDINGS = new Set(['owner', 'admin', 'member', 'guest']);

function chatRoleOf(value: unknown): PermissionSender['chatRole'] {
  return value === 'owner' || value === 'admin' || value === 'trusted' ? value : undefined;
}

export function normalizePermissionStanding(value: unknown): PermissionPlatformStanding | undefined {
  if (!record(value) || typeof value.standing !== 'string' || !STANDINGS.has(value.standing)) return undefined;
  const roles = Array.isArray(value.roles)
    ? value.roles.filter((role): role is { id: string; name?: string } => record(role) && typeof role.id === 'string' && role.id.length > 0)
    : undefined;
  const permissions = Array.isArray(value.permissions)
    ? value.permissions.filter((permission): permission is string => typeof permission === 'string' && permission.length > 0)
    : undefined;
  return Object.freeze({
    standing: value.standing as PermissionPlatformStanding['standing'],
    ...(roles?.length ? { roles: Object.freeze(roles) } : {}),
    ...(permissions?.length ? { permissions: Object.freeze(permissions) } : {}),
  });
}

function senderOf(value: unknown): PermissionSender | undefined {
  if (!record(value)) return undefined;
  const chatRole = chatRoleOf(value.chatRole);
  const platform = normalizePermissionStanding(value.platform);
  return Object.freeze({
    id: String(value.id ?? ''),
    ...(value.name ? { name: String(value.name) } : {}),
    ...(chatRole ? { chatRole } : {}),
    ...(platform ? { platform } : {}),
  });
}

/**
 * 从 message-like 对象投影为 PermissionSubject（鸭式）。
 * 接受 canonical Runtime `Message` / `CommandSession` / 任意含同名字段的对象。
 */
export function toPermissionSubject(source: unknown): PermissionSubject {
  if (!record(source)) return {};
  const obj = source;
  const result: Record<string, unknown> = {};

  // CommandSession 风格
  if (typeof obj.adapter === 'string') result.adapter = obj.adapter;
  if (typeof obj.endpoint === 'string') result.endpoint = obj.endpoint;
  if (record(obj.scene)) result.scene = obj.scene;

  // canonical Runtime Message
  if (typeof obj.clientAdapter === 'string' && !result.adapter) result.adapter = obj.clientAdapter;
  if (typeof obj.endpointId === 'string' && !result.endpoint) result.endpoint = obj.endpointId;
  if (record(obj.conversation) && !result.scene) {
    const ch = obj.conversation;
    const endpoint = record(ch.endpoint) ? ch.endpoint : undefined;
    if (!result.adapter && typeof endpoint?.adapter === 'string') result.adapter = endpoint.adapter;
    if (!result.endpoint && typeof endpoint?.id === 'string') result.endpoint = endpoint.id;
    result.scene = {
      id: String(ch.id ?? ''),
      type: String(ch.kind ?? ''),
      ...(ch.name ? { name: String(ch.name) } : {}),
    };
  }
  const sender = senderOf(obj.sender);
  if (sender) result.sender = sender;

  return result as PermissionSubject;
}
