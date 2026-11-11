export * from './legacy-command-migrator.js';
export * from './package-cutover.js';
export * from './readiness.js';
export * from './verify.js';
export {
  applyInstanceDeclarationMigration,
  assertNoPendingInstanceMigration,
  assertStopped,
  formatInstanceMigrationPreview,
  planInstanceDeclarationMigration,
  recoverInstanceDeclarationMigration,
  withProjectLock,
  type InstanceDeclarationMigrationPlan,
  type InstanceMigrationApplyOptions,
  type InstanceMigrationApplyResult,
  type InstanceMigrationFile,
} from '@zhin.js/gateway/project';
