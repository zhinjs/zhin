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
  AMBIENT_JUDGE_DAYS,
  AMBIENT_STATUS_PERMISSION,
  AssistantStatus,
  SKILLS_STATUS_PERMISSION,
  type AmbientCompareCounts,
  type AmbientCompareStatus,
  type AmbientJudgeDay,
  type AmbientJudgeMember,
  type AmbientJudgeView,
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
export { readScheduleJobLabels } from './schedule-job-labels.js';
export { defineWorkspaceConversationTable, readWorkspaceConversationNames } from './workspace-conversations.js';
export { installConsoleIam, type ConsoleIamInstallation, type InstallConsoleIamOptions } from '@zhin.js/gateway/iam';
export { installHostConsoleTerminal, type InstallHostConsoleTerminalOptions } from '@zhin.js/gateway/terminal';
export {
  containsEnvironmentReference, dispatchFeatureConsoleRpc, type FeatureRecentConversation, type FeatureRpcContext, type FeatureRpcReply, type FeatureStores,
} from './console-feature-rpc.js';
export {
  defineFeatureOverrideTable, FeatureOverrideStore, FeatureOverrideStorageUnavailableError, FEATURE_OVERRIDE_TABLE,
} from './feature-override-store.js';
export {
  MAX_RUNTIME_FAILURES, RUNTIME_FAILURE_ABSENT_GRACE_MS, RuntimeFailureJournal, endpointFailureSubject, readRuntimeFailureFile, startRuntimeFailureSync,
  syncEndpointFailures, syncMcpFailures, syncRuntimeFailures,
  type RuntimeFailureEndpointRow, type RuntimeFailureEntry, type RuntimeFailureJournalOptions, type RuntimeFailureMcpRow,
  type RuntimeFailureReport, type RuntimeFailureSyncOptions,
} from './runtime-failures.js';
export { listMcpServerStatus } from './agent-runtime-resolver.js';
export type { InferenceAccountAttentionRow, PurposeEffectRow } from './agent-insights.js';
