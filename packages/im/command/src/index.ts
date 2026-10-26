/**
 * Command authoring contracts, parameter schemas, and permit helpers.
 * @module @zhin.js/command
 */
/** @internal Runtime command projection. */
export * from './command-index.js';
/** @public Command authoring contract and `defineCommand`. */
export * from './definition.js';
export * from './permission-explanation.js';
export {
  CONVERSATION_MANAGER_PERMIT,
  canManageConversation,
  assertBuiltinPermits,
  checkBuiltinPermit,
  checkBuiltinPermitList,
  isBuiltinPermit,
  isPlatformPermit,
  parsePermitName,
  type ParsedPermit,
  type PermitKind,
} from './permit.js';
export {
  bindCommandSource,
  CommandPathSyntaxError,
  commandFeatureId,
  type BoundCommandSource,
  default as commandFeature,
} from './provider.js';
export { default } from './provider.js';

export type { CommandValidationIssue, CommandValidationIssueCode } from './arguments.js';
