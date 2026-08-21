export type SandboxSafetyMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type SandboxApprovalMode = 'ask' | 'deny' | 'allow';

export interface SandboxAgentRunConfig {
  readonly workingDirectory: string;
  readonly safetyMode: SandboxSafetyMode;
  readonly approvalMode: SandboxApprovalMode;
  readonly networkAccess: boolean;
}

export const DEFAULT_SANDBOX_AGENT_RUN_CONFIG: SandboxAgentRunConfig = Object.freeze({
  workingDirectory: '',
  safetyMode: 'workspace-write',
  approvalMode: 'ask',
  networkAccess: false,
});

const SAFETY_MODES = new Set<SandboxSafetyMode>(['read-only', 'workspace-write', 'danger-full-access']);
const APPROVAL_MODES = new Set<SandboxApprovalMode>(['ask', 'deny', 'allow']);

export function normalizeSandboxAgentRunConfig(value: unknown): SandboxAgentRunConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const workingDirectory = typeof input.workingDirectory === 'string'
    ? input.workingDirectory.trim().slice(0, 4096)
    : '';
  const safetyMode = SAFETY_MODES.has(input.safetyMode as SandboxSafetyMode)
    ? input.safetyMode as SandboxSafetyMode
    : DEFAULT_SANDBOX_AGENT_RUN_CONFIG.safetyMode;
  const approvalMode = APPROVAL_MODES.has(input.approvalMode as SandboxApprovalMode)
    ? input.approvalMode as SandboxApprovalMode
    : DEFAULT_SANDBOX_AGENT_RUN_CONFIG.approvalMode;
  return Object.freeze({
    workingDirectory,
    safetyMode,
    approvalMode,
    // Full host access cannot be combined with a portable network namespace.
    // Keep the contract honest: danger mode includes network authority.
    networkAccess: safetyMode === 'danger-full-access' || input.networkAccess === true,
  });
}
