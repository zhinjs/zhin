import type { ScheduleJobCreator } from '../assistant/types.js';
import { runToolPolicies, type ToolPolicyInput } from '../security/policy-facade.js';
import type { AgentTool } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import type { ZhinAgentConfig } from '../config/zhin-agent-config.js';
import type {
  HostScheduleSecurityContext as ScheduleSecurityContext,
  HostScheduleSecurityDenial as ScheduleSecurityDenial,
} from '../internal/host-types.js';
import { runWithToolNetworkPolicy, type ToolNetworkPolicy } from '../security/network-policy-context.js';
import { extractUrlsFromCommand } from '../security/network-policy.js';

export type { ScheduleSecurityContext, ScheduleSecurityDenial };

export function createScheduleSecurityContext(
  execPreset: ScheduleSecurityContext['execPreset'] = 'readonly',
  allowedDomains: string[] = [],
): ScheduleSecurityContext {
  return { execPreset, rejectOwnerApproval: true, allowedDomains: [...allowedDomains] };
}

export function demoteScheduleCreator(creator: ScheduleJobCreator): ScheduleJobCreator {
  const roles = creator.roles.includes('master')
    ? ['trusted'] as const
    : creator.roles.includes('trusted')
      ? ['user'] as const
      : [];
  return { ...creator, roles };
}

export function hardenSchedulePolicyInput(
  input: ToolPolicyInput,
  context: ScheduleSecurityContext,
): ToolPolicyInput {
  return {
    ...input,
    config: input.config
      ? {
          ...input.config,
          execSecurity: 'allowlist',
          execPreset: context.execPreset,
          execApprovalMode: context.rejectOwnerApproval ? 'deny' : input.config.execApprovalMode,
        }
      : undefined,
  };
}

export interface SecureScheduleToolsInput {
  tools: AgentTool[];
  message: Message;
  config: Required<ZhinAgentConfig>;
  context: ScheduleSecurityContext;
  onDenial?: (denial: ScheduleSecurityDenial) => void;
}

function pathArgument(args: Record<string, unknown>): string | undefined {
  const value = args.path ?? args.file_path ?? args.filePath ?? args.cwd;
  return typeof value === 'string' ? value : undefined;
}

const NETWORK_COMMAND = /(?:^|[;&|]\s*)(curl|wget|ping|dig|nslookup|host)\b/i;

export function secureScheduleTools(input: SecureScheduleToolsInput): AgentTool[] {
  const networkPolicy: ToolNetworkPolicy = {
    httpsOnly: true,
    allowedDomains: input.context.allowedDomains,
  };
  return input.tools.map(tool => ({
    ...tool,
    execute: async (args: Record<string, unknown>) => {
      const command = tool.name === 'bash' ? String(args.command ?? '') : undefined;
      const filePath = pathArgument(args);
      const networkUrls = [
        ...(typeof args.url === 'string' ? [args.url] : []),
        ...(command ? extractUrlsFromCommand(command) : []),
      ];
      if (command && NETWORK_COMMAND.test(command) && networkUrls.length === 0) {
        const denial = {
          tool: tool.name,
          policy: 'network-access',
          reason: '无人值守网络命令必须包含可校验的绝对 HTTPS URL',
        };
        input.onDenial?.(denial);
        return `Error: ${denial.reason}`;
      }
      for (const networkUrl of networkUrls) {
        const decision = runToolPolicies({ toolName: tool.name, networkUrl, networkPolicy });
        if (!decision.allowed) {
          const denial = {
            tool: tool.name,
            policy: decision.deniedBy ?? 'network-access',
            reason: decision.reason ?? '网络访问被拒绝',
          };
          input.onDenial?.(denial);
          return `Error: ${denial.reason}`;
        }
      }
      const policy = runToolPolicies(hardenSchedulePolicyInput({
        toolName: tool.name,
        command,
        filePath,
        rawFilePath: filePath,
        commMessage: input.message,
        config: input.config,
      }, input.context));
      if (!policy.allowed || policy.needsOwnerApproval) {
        const denial = {
          tool: tool.name,
          policy: policy.deniedBy ?? 'schedule-security',
          reason: policy.reason ?? '无人值守执行不允许审批或越权操作',
        };
        input.onDenial?.(denial);
        return `Error: ${denial.reason}`;
      }
      return runWithToolNetworkPolicy(networkPolicy, () => tool.execute(args));
    },
  }));
}
