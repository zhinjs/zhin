export { installConsoleIam, projectEnvironment, type ConsoleIamInstallation, type InstallConsoleIamOptions } from './install.js';
export {
  accountInputProblem,
  IAM_UNAVAILABLE_PUBLIC_MESSAGE,
  ConsoleIamService,
  IamError,
  type BindingInput,
  type ConsoleAuditView,
  type ConsoleBindingView,
  type ConsoleCredentialRevocation,
  type ConsoleCredentialRevocationReason,
  type ConsoleIamServiceOptions,
  type ConsoleRoleView,
  type ConsoleTokenView,
  type ConsoleUserView,
  type IamDatabase,
  type IamErrorCode,
} from './service.js';
export {
  ConsoleSetupService,
  SETUP_CONSOLE_ROLE_NOTICE,
  SETUP_NO_MIGRATION_NOTICE,
  upsertDotenv,
  type ConsoleSetupServiceOptions,
  type SetupConfigPort,
  type SetupDatabaseField,
  type SetupDatabaseInput,
  type SetupDatabaseSummary,
  type SetupDriver,
  type SetupEnvFilePort,
  type SetupStatus,
} from './setup-service.js';
export { defineConsoleIamTables, IAM_TABLE_DEFINITIONS, IAM_TABLES, type IamTableHost } from './tables.js';
export {
  importLegacyIamTables,
  isTransientLegacyImportError,
  LEGACY_IMPORT_FAILURE_KEY,
  resetGatewayStore,
  type LegacyImportFailure,
  inspectLegacyIamImport,
  LEGACY_IMPORT_KEY,
  LegacyImportError,
  legacyImportSettled,
  readLegacyImportRecord,
  revertLegacyIamImport,
  tableChecksum,
  type LegacyIamSource,
  type LegacyImportErrorCode,
  type LegacyImportInspection,
  type LegacyImportOptions,
  type LegacyImportRecord,
  type LegacySourceSummary,
  type RevertLegacyImportResult,
} from './legacy-import.js';
export { dispatchIamRpc, isIamRpc } from './rpc.js';
export { registerConsoleAuthRoutes } from './routes.js';
export { LoginRateLimiter } from './rate-limit.js';
export { createLocalConsoleAdmin, type LocalConsoleAdmin, type LocalConsoleAdminOptions, type LocalConsoleAdminResult } from './local-admin.js';
