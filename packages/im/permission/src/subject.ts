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
  /** Framework roles plus the platform standing (`owner` / `admin` / `member` / `guest`). */
  readonly role: readonly string[];
  /** Platform-native permission names (`sender.platform.permissions`). */
  readonly permissions?: readonly string[];
  /** Platform-native role ids (`sender.platform.roles`). */
  readonly platformRoleIds?: readonly string[];
}

export interface PermissionSubject {
  readonly adapter?: string;
  readonly endpoint?: string;
  readonly scene?: PermissionScene;
  readonly sender?: PermissionSender;
}

/**
 * 从 message-like 对象投影为 PermissionSubject（鸭式）。
 * 接受 canonical Runtime `Message` / `CommandSession` / 任意含同名字段的对象。
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

  // canonical Runtime Message
  if (typeof obj.clientAdapter === 'string' && !result.adapter) result.adapter = obj.clientAdapter;
  if (typeof obj.endpointId === 'string' && !result.endpoint) result.endpoint = obj.endpointId;
  if (obj.conversation && typeof obj.conversation === 'object' && !result.scene) {
    const ch = obj.conversation as Record<string, unknown>;
    const endpoint = ch.endpoint as Record<string, unknown> | undefined;
    if (!result.adapter && typeof endpoint?.adapter === 'string') result.adapter = endpoint.adapter;
    if (!result.endpoint && typeof endpoint?.id === 'string') result.endpoint = endpoint.id;
    result.scene = {
      id: String(ch.id ?? ''),
      type: String(ch.kind ?? ''),
      ...(ch.name ? { name: String(ch.name) } : {}),
    };
  }
  if (obj.sender && typeof obj.sender === 'object' && !result.sender) {
    const s = obj.sender as Record<string, unknown>;
    // Framework roles (master / trusted) + the normalized platform standing (ADR 0056 §1).
    // Adapter metadata never contributes roles or permissions.
    const roles = new Set(Array.isArray(s.roles) ? s.roles.map(String) : []);
    const platform = s.platform && typeof s.platform === 'object' ? s.platform as Record<string, unknown> : undefined;
    if (typeof platform?.standing === 'string') roles.add(platform.standing);
    const permissions = new Set(Array.isArray(platform?.permissions) ? platform.permissions.map(String) : []);
    const platformRoleIds = Array.isArray(platform?.roles)
      ? platform.roles.map((role) => (role && typeof role === 'object' ? String((role as { id?: unknown }).id ?? '') : '')).filter(Boolean)
      : [];
    result.sender = {
      id: String(s.id ?? ''),
      ...(s.name ? { name: String(s.name) } : {}),
      role: [...roles],
      ...(permissions.size > 0 ? { permissions: [...permissions] } : {}),
      ...(platformRoleIds.length > 0 ? { platformRoleIds } : {}),
    };
  }

  return result as PermissionSubject;
}
