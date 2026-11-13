export {
  installConsoleApiResources,
  startConsoleControlPlane,
} from './api-installer.js';
export { ConsoleConfigurationStore, ConfigChatRequestRejectedError } from '@zhin.js/gateway/config';
export type { ChatConfigurationRead } from '@zhin.js/gateway/config';
export { ConfigChatAccessError } from '@zhin.js/gateway/config';
export { parseConfigurationPath, formatConfigurationPath } from '@zhin.js/gateway/config';
export { ConfigPatchScopeError } from '@zhin.js/gateway/config';
export {
  createConsoleHostModules,
  installConsoleRuntime,
  registerConsoleHttp,
} from './host.js';
export { SystemLogStore, resolveSystemLogConfig } from './system-log.js';

export {
  AMBIENT_STATUS_PERMISSION,
  AssistantStatus,
  SKILLS_STATUS_PERMISSION,
  type AmbientStatus,
  type SkillsStatus,
} from './assistant-status.js';
export {
  CONSOLE_TOOL_APPROVAL_OPERATOR,
  HostToolApprovals,
  createHostToolApprovalConsoleRpc,
  TOOL_APPROVALS_READ_PERMISSION,
  TOOL_APPROVALS_RESOLVE_PERMISSION,
  composeHostConsoleRpc,
  type ToolApprovalCard,
} from './tool-approvals.js';
export { HostSelfChanges, type SelfChangeCard } from './self-changes.js';
export { defineWorkspaceConversationTable } from './workspace-conversations.js';
export { installConsoleIam, type ConsoleIamInstallation, type InstallConsoleIamOptions } from '@zhin.js/gateway/iam';
export { installHostConsoleTerminal, type InstallHostConsoleTerminalOptions } from '@zhin.js/gateway/terminal';
export {
  containsEnvironmentReference, dispatchFeatureConsoleRpc, type FeatureRecentConversation, type FeatureRpcContext, type FeatureRpcReply, type FeatureStores,
} from './console-feature-rpc.js';
export {
  defineFeatureOverrideTable, FeatureOverrideStore, FeatureOverrideStorageUnavailableError, FEATURE_OVERRIDE_TABLE,
} from './feature-override-store.js';
