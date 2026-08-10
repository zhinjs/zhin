export {
  type PermissionHost,
  type PermissionChecker,
  type PlatformPermitChecker,
  createPermissionHost,
} from './host.js';

export { permissionHostToken } from './token.js';

export {
  type PermissionSubject,
  type PermissionScene,
  type PermissionSender,
  toPermissionSubject,
} from './subject.js';

export {
  type PermitKind,
  type ParsedPermit,
  type ParsedPlatformPermit,
  parsePermitName,
  parsePlatformPermitName,
  isBuiltinPermit,
  isPlatformPermit,
  assertPermitSyntax,
  checkBuiltinPermit,
  checkBuiltinPermitList,
} from './builtin.js';

export {
  type PermissionDefinition,
  type PlatformPermissionDefinition,
  definePermission,
  definePlatformPermission,
} from './define.js';

export { createSceneRolePlatformChecker } from './helpers.js';
