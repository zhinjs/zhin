export {
  PermissionHost,
  type PermissionChecker,
  type BotStandingResolver,
  type PermissionCheckOptions,
  type PermissionSenderRoles,
  type SenderRoleResolver,
} from './host.js';

export { permissionHostToken } from './token.js';

export {
  type PermissionSubject,
  type PermissionScene,
  type PermissionSender,
  type PermissionPlatformStanding,
  type PermissionChatRoleLevel,
  type PermissionChatRoleLevels,
  toPermissionSubject,
  normalizePermissionStanding,
  normalizePermissionChatRoleLevels,
} from './subject.js';

export {
  type PermitKind,
  type PermitChatRole,
  type PermitChatRoleLevel,
  type ParsedPermit,
  parsePermitName,
  isBuiltinPermit,
  permitsNeedBotStanding,
  BOT_PERMIT_KINDS,
  removedPermitReplacement,
  assertPermitSyntax,
  checkBuiltinPermit,
  checkBuiltinPermitList,
} from './builtin.js';

export {
  type PermissionDefinition,
  definePermission,
} from './define.js';

export * from './check-permissions.js';
export * from './explain.js';
