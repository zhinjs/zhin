export { installConsoleIam, projectEnvironment, type ConsoleIamInstallation, type InstallConsoleIamOptions } from './install.js';
export {
  accountInputProblem,
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
export { defineConsoleIamTables, IAM_DIALECTS, IAM_TABLE_DEFINITIONS, IAM_TABLES } from './tables.js';
export { dispatchIamRpc, isIamRpc } from './rpc.js';
export { registerConsoleAuthRoutes } from './routes.js';
export { LoginRateLimiter } from './rate-limit.js';
export { createLocalConsoleAdmin, type LocalConsoleAdmin, type LocalConsoleAdminOptions, type LocalConsoleAdminResult } from './local-admin.js';
