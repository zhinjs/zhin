import { IAM_RPC } from '@zhin.js/console-protocol';
import type { ConsolePrincipal } from '@zhin.js/host-http';
import { IamError, type BindingInput, type ConsoleIamService } from './service.js';

export interface IamRpcReply {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

const IAM_TYPES: ReadonlySet<string> = new Set(Object.values(IAM_RPC));

export function isIamRpc(type: unknown): boolean {
  return typeof type === 'string' && IAM_TYPES.has(type);
}

/**
 * `iam.*` Console RPC. The caller has already passed the permission gate
 * (`iam.view` / `iam.manage`); this only validates input and runs the operation.
 */
export async function dispatchIamRpc(
  message: Readonly<Record<string, unknown>>,
  service: ConsoleIamService | undefined,
  principal: ConsolePrincipal,
): Promise<IamRpcReply> {
  const requestId = message.requestId;
  const type = String(message.type ?? '');
  const payload = (message.data && typeof message.data === 'object' && !Array.isArray(message.data)
    ? message.data
    : message) as Record<string, unknown>;
  const ok = (data: unknown): IamRpcReply => ({ status: 200, body: { success: true, data, type, requestId } });
  try {
    if (!service?.ready) throw new IamError('unavailable', '当前数据库不能存储账号，或尚未就绪');
    const id = (key = 'id') => {
      const value = payload[key];
      if (typeof value !== 'string' || !value) throw new IamError('invalid_input', `${key} 必填`);
      return value;
    };
    switch (type) {
      case IAM_RPC.USERS_LIST: return ok({ users: await service.listUsers() });
      case IAM_RPC.USERS_CREATE: return ok({ user: await service.createUser({
        username: payload.username, password: payload.password, displayName: payload.displayName,
        bindings: bindingsOf(payload.bindings ?? []),
      }) });
      case IAM_RPC.USERS_UPDATE: return ok({ user: await service.updateUser(id(), { displayName: payload.displayName, disabled: payload.disabled }) });
      case IAM_RPC.USERS_DISABLE: return ok({ user: await service.setDisabled(id(), payload.disabled !== false) });
      case IAM_RPC.USERS_DELETE: await service.deleteUser(id()); return ok({ deleted: true });
      case IAM_RPC.USERS_RESET_PASSWORD: await service.resetPassword(id(), payload.password); return ok({ reset: true });
      case IAM_RPC.ROLES_LIST: return ok({ roles: await service.listRoles(), pluginPermissions: service.pluginPermissionCatalog() });
      case IAM_RPC.ROLES_CREATE: return ok(withWarnings(service, { role: await service.createRole({ name: payload.name, description: payload.description, permissions: payload.permissions }) }));
      case IAM_RPC.ROLES_UPDATE: return ok(withWarnings(service, { role: await service.updateRole(id(), { description: payload.description, permissions: payload.permissions }) }));
      case IAM_RPC.ROLES_DELETE: await service.deleteRole(id()); return ok({ deleted: true });
      case IAM_RPC.BINDINGS_SET: return ok({ user: await service.setBindings(id('userId'), bindingsOf(payload.bindings)) });
      case IAM_RPC.TOKENS_LIST: return ok({ tokens: await service.listTokens(typeof payload.userId === 'string' ? payload.userId : undefined) });
      case IAM_RPC.TOKENS_CREATE: {
        const userId = typeof payload.userId === 'string' && payload.userId
          ? payload.userId
          : principal.kind === 'bootstrap' ? id('userId') : principal.userId;
        const created = await service.createToken(userId, { name: payload.name, permissions: payload.permissions, expiresAt: payload.expiresAt });
        return ok({ token: created.token, record: created.record, ...pluginWarnings(service, created.record.permissions ?? []) });
      }
      case IAM_RPC.TOKENS_REVOKE: await service.revokeToken(id()); return ok({ revoked: true });
      case IAM_RPC.AUDIT_LIST: return ok(await service.listAudit({
        actor: payload.actor, action: payload.action, since: payload.since, until: payload.until,
        limit: payload.limit, before: payload.before,
      }));
      default: return { status: 400, body: { success: false, error: `Unknown RPC type: ${type}`, requestId } };
    }
  } catch (error) {
    if (error instanceof IamError) {
      return { status: error.status, body: { success: false, code: error.code, error: error.message, requestId } };
    }
    return { status: 500, body: { success: false, code: 'failed', error: '访问控制操作失败', requestId } };
  }
}

/** `warnings` for plugin permissions no loaded plugin uses yet (accepted; they grant nothing until one does). */
function pluginWarnings(service: ConsoleIamService, permissions: readonly string[]): { warnings?: readonly string[] } {
  const unknown = service.unknownPluginPermissions(permissions);
  return unknown.length ? { warnings: unknown.map(permission => `插件权限 ${permission} 当前没有已加载的插件使用`) } : {};
}

function withWarnings<T extends { role: { permissions: readonly string[] } }>(service: ConsoleIamService, data: T): T & { warnings?: readonly string[] } {
  return { ...data, ...pluginWarnings(service, data.role.permissions) };
}

export function bindingsOf(value: unknown): readonly BindingInput[] {
  if (!Array.isArray(value)) throw new IamError('invalid_input', 'bindings 必须是数组');
  return value.map(item => {
    if (!item || typeof item !== 'object') throw new IamError('invalid_input', 'binding 无效');
    const record = item as Record<string, unknown>;
    if (typeof record.role !== 'string') throw new IamError('invalid_input', 'binding.role 必填');
    return {
      role: record.role,
      ...(typeof record.scopeKind === 'string' ? { scopeKind: record.scopeKind } : {}),
      ...(typeof record.scopeKey === 'string' ? { scopeKey: record.scopeKey } : {}),
    };
  });
}
