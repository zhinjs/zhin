/**
 * IM 运维 / Endpoint 管理斜杠命令：仅 master 或 trusted 可执行。
 */
import {
  mergeAITriggerConfig,
  resolveSenderRoles,
  type AITriggerConfig,
} from './ai-trigger.js';
import { hasSenderRole } from './roles.js';
import type { Message } from '../message.js';
import type { Plugin } from '../plugin.js';

export const MANAGEMENT_COMMAND_DENIED =
  '⚠️ 该命令仅 Endpoint Owner（master）或 trusted 操作员可用。';

/** 运维 / 内省 / Endpoint 管理命令：仅 master 或 trusted 可执行与展示 */
export const MANAGEMENT_OPERATOR_PERMIT = 'role(master,trusted)' as const;

/** Endpoint Owner 私聊专用命令（如 /approve） */
export const OWNER_OPERATOR_PERMIT = 'role(master)' as const;
export const OWNER_PRIVATE_PERMITS = [OWNER_OPERATOR_PERMIT, 'private(*)'] as const;

export function resolveManagementCommandRoles(
  message: Message,
  root: Plugin,
  triggerConfig?: AITriggerConfig,
): ReturnType<typeof resolveSenderRoles>['roles'] {
  const cfg = mergeAITriggerConfig(triggerConfig ?? {});
  const adapterInstance = root.inject(message.$adapter) as
    | { endpoints?: Map<string, { $config?: Record<string, unknown> }> }
    | undefined;
  const endpointConfig = adapterInstance?.endpoints?.get(message.$endpoint)?.$config;
  return resolveSenderRoles(message, cfg, endpointConfig).roles;
}

/** 通过返回 null；拒绝返回用户可见提示文案 */
export function rejectUnlessManagementOperator(
  message: Message,
  root: Plugin,
  triggerConfig?: AITriggerConfig,
): string | null {
  const roles = resolveManagementCommandRoles(message, root, triggerConfig);
  if (hasSenderRole(roles, 'trusted')) {
    return null;
  }
  return MANAGEMENT_COMMAND_DENIED;
}
