/**
 * PermissionSubject — duck-typed 鉴权主体（与 CommandSession 同构）。
 * 不依赖 `@zhin.js/core`；任何带有 adapter/endpoint/scene/sender 的对象都可投影。
 */

export interface PermissionScene {
  readonly id: string;
  readonly type: string;
  readonly name?: string;
}

export interface PermissionSender {
  readonly id: string;
  readonly name?: string;
  readonly role: readonly string[];
  readonly permissions?: readonly string[];
}

export interface PermissionSubject {
  readonly adapter?: string;
  readonly endpoint?: string;
  readonly scene?: PermissionScene;
  readonly sender?: PermissionSender;
}

/**
 * 从 message-like 对象投影为 PermissionSubject（鸭式）。
 * 接受 `Message` / `CommandSession` / 任意含同名字段的对象。
 */
export function toPermissionSubject(source: unknown): PermissionSubject {
  if (!source || typeof source !== 'object') return {};
  const obj = source as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  // CommandSession 风格
  if (typeof obj.adapter === 'string') result.adapter = obj.adapter;
  if (typeof obj.endpoint === 'string') result.endpoint = obj.endpoint;
  if (obj.scene && typeof obj.scene === 'object') result.scene = obj.scene;
  if (obj.sender && typeof obj.sender === 'object' && Array.isArray((obj.sender as { role?: unknown }).role)) {
    result.sender = obj.sender;
  }

  // Message 风格（$adapter / $endpoint / $channel / $sender）
  if (typeof obj.$adapter === 'string' && !result.adapter) result.adapter = obj.$adapter;
  if (typeof obj.$endpoint === 'string' && !result.endpoint) result.endpoint = obj.$endpoint;
  if (obj.$channel && typeof obj.$channel === 'object' && !result.scene) {
    const ch = obj.$channel as Record<string, unknown>;
    result.scene = {
      id: String(ch.id ?? ''),
      type: String(ch.type ?? ''),
      ...(ch.name ? { name: String(ch.name) } : {}),
    };
  }
  if (obj.$sender && typeof obj.$sender === 'object' && !result.sender) {
    const s = obj.$sender as Record<string, unknown>;
    const roles = new Set(
      Array.isArray(s.role) ? s.role.map(String) : (typeof s.role === 'string' ? [s.role] : []),
    );
    // 生产合成消息带 isMaster/isTrusted 标志而非 role 数组，须投影为角色
    if (s.isMaster === true) roles.add('master');
    if (s.isTrusted === true) roles.add('trusted');
    result.sender = {
      id: String(s.id ?? ''),
      ...(s.name ? { name: String(s.name) } : {}),
      role: [...roles],
      ...(Array.isArray(s.permissions) ? { permissions: s.permissions.map(String) } : {}),
    };
  }

  return result as PermissionSubject;
}
