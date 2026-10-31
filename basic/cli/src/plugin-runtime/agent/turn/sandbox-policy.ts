import * as path from 'node:path';
import type { TurnRequest } from '@zhin.js/agent';

export interface SandboxTurnPolicyInput {
  readonly platform: string;
  readonly isMaster: boolean;
  /** Conversation scope of the IM turn; IM shell access is only ever granted in private chats. */
  readonly scope?: 'private' | 'group' | 'channel';
  /** `ai.agent.masterShell`; anything but 'isolated' keeps bash disabled outside the sandbox. */
  readonly masterShell?: 'off' | 'isolated';
  /** `ai.agent.masterShellApprovalMode`; defaults to `ask` so the master is asked instead of silently reviewed. */
  readonly masterShellApprovalMode?: 'ask' | 'auto' | 'inherit';
  /** `ai.agent.execApprovalMode`; only read when `masterShellApprovalMode: inherit`. */
  readonly execApprovalMode?: 'ask' | 'auto' | 'bypass';
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly projectRoot: string;
  readonly defaultNetwork?: TurnRequest['policy']['network'];
}

export interface ResolvedSandboxTurnPolicy {
  readonly filesystem: NonNullable<TurnRequest['policy']['filesystem']>;
  readonly shell?: TurnRequest['policy']['shell'];
  readonly network?: TurnRequest['policy']['network'];
}

/**
 * Sandbox is an authenticated local development ingress. Only its configured
 * owner may turn wire configuration into execution authority; all other IM
 * metadata is ignored and keeps the process defaults.
 */
export function resolveSandboxTurnPolicy(input: SandboxTurnPolicyInput): ResolvedSandboxTurnPolicy {
  const fallback = Object.freeze({
    filesystem: Object.freeze({
      workspaceRoot: input.projectRoot,
      workingDirectory: input.projectRoot,
      access: 'workspace-write' as const,
    }),
    ...(input.defaultNetwork ? { network: input.defaultNetwork } : {}),
  });
  if (input.platform !== 'sandbox') {
    return allowsMasterImShell(input)
      ? Object.freeze({ ...fallback, shell: masterImIsolatedShell(resolveMasterShellApprovalMode(input)) })
      : fallback;
  }
  if (!input.isMaster) return fallback;
  const run = readRunConfig(input.metadata.sandboxAgentRun);
  if (!run) return fallback;

  const workingDirectory = path.resolve(input.projectRoot, run.workingDirectory || '.');
  const workspaceRoot = run.safetyMode === 'danger-full-access'
    ? path.parse(workingDirectory).root
    : workingDirectory;
  const network = run.networkAccess
    ? Object.freeze({ enabled: true, httpsOnly: true, allowedDomains: Object.freeze([]) })
    : undefined;
  const shell: NonNullable<TurnRequest['policy']['shell']> = run.safetyMode === 'read-only'
    ? Object.freeze({
        preset: run.networkAccess ? 'network' : 'readonly',
        security: 'allowlist',
        execPreset: run.networkAccess ? 'network' : 'readonly',
        approvalMode: 'auto',
        isolation: 'required',
      })
    : run.safetyMode === 'workspace-write'
      ? Object.freeze({
          security: 'allowlist',
          execPreset: 'development',
          approvalMode: run.approvalMode,
          isolation: 'required',
        })
      : Object.freeze({
          security: 'full',
          execPreset: 'custom',
          approvalMode: 'bypass',
          isolation: 'none',
        });
  return Object.freeze({
    filesystem: Object.freeze({
      workspaceRoot,
      workingDirectory,
      access: run.safetyMode,
    }),
    shell,
    ...(network ? { network } : {}),
  });
}

/**
 * Opt-in shell for the master's IM private chat. Always container-isolated:
 * the bash port refuses `isolation: 'none'` unless access is danger-full-access,
 * and there is deliberately no IM path to that.
 */
function masterImIsolatedShell(approvalMode: 'ask' | 'auto' | 'bypass'): NonNullable<TurnRequest['policy']['shell']> {
  return Object.freeze({
    security: 'allowlist',
    execPreset: 'development',
    approvalMode,
    isolation: 'required',
  });
}

/**
 * The master's own DM must not silently override the operator's approval choice:
 * `ask` (default) puts a confirmation card in front of the master, `inherit`
 * follows `execApprovalMode`, `auto` keeps the reviewer (which escalates rejections).
 */
export function resolveMasterShellApprovalMode(
  input: Pick<SandboxTurnPolicyInput, 'masterShellApprovalMode' | 'execApprovalMode'>,
): 'ask' | 'auto' | 'bypass' {
  switch (input.masterShellApprovalMode) {
    case 'auto':
      return 'auto';
    case 'inherit':
      return input.execApprovalMode ?? 'auto';
    default:
      return 'ask';
  }
}

function allowsMasterImShell(input: SandboxTurnPolicyInput): boolean {
  return input.masterShell === 'isolated' && input.isMaster && input.scope === 'private';
}

function readRunConfig(value: unknown): Readonly<{
  workingDirectory: string;
  safetyMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalMode: 'ask' | 'auto' | 'bypass';
  networkAccess: boolean;
}> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.workingDirectory !== 'string') return undefined;
  if (item.safetyMode !== 'read-only' && item.safetyMode !== 'workspace-write' && item.safetyMode !== 'danger-full-access') return undefined;
  if (item.approvalMode !== 'ask' && item.approvalMode !== 'auto' && item.approvalMode !== 'bypass') return undefined;
  return {
    workingDirectory: item.workingDirectory.trim().slice(0, 4096),
    safetyMode: item.safetyMode,
    approvalMode: item.approvalMode,
    networkAccess: item.safetyMode === 'danger-full-access' || item.networkAccess === true,
  };
}
