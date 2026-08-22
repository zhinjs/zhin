import * as path from 'node:path';
import type { TurnRequest } from '@zhin.js/agent';

export interface SandboxTurnPolicyInput {
  readonly platform: string;
  readonly isMaster: boolean;
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
  if (input.platform !== 'sandbox' || !input.isMaster) return fallback;
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
        approvalMode: 'deny',
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
          approvalMode: 'allow',
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

function readRunConfig(value: unknown): Readonly<{
  workingDirectory: string;
  safetyMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalMode: 'ask' | 'deny' | 'allow';
  networkAccess: boolean;
}> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.workingDirectory !== 'string') return undefined;
  if (item.safetyMode !== 'read-only' && item.safetyMode !== 'workspace-write' && item.safetyMode !== 'danger-full-access') return undefined;
  if (item.approvalMode !== 'ask' && item.approvalMode !== 'deny' && item.approvalMode !== 'allow') return undefined;
  return {
    workingDirectory: item.workingDirectory.trim().slice(0, 4096),
    safetyMode: item.safetyMode,
    approvalMode: item.approvalMode,
    networkAccess: item.safetyMode === 'danger-full-access' || item.networkAccess === true,
  };
}
