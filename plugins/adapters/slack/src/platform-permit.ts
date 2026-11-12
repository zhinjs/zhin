/**
 * Slack platform permit — workspace + channel 权限
 */
import type { PermissionSubject } from '@zhin.js/permission';


export function platformPermit(perm: string): string {
  return `platform-permission:${perm}`;
}

const FACTORY_PERM_MAP: Record<string, string> = {
  admin: 'channel_manager',
  owner: 'workspace_owner',
};

export function slackGroupPermitResolver(logicalPerm: string): string {
  return platformPermit(FACTORY_PERM_MAP[logicalPerm] ?? logicalPerm);
}

export function normalizeSlackSenderForPermit(input: {
  isWorkspaceOwner?: boolean;
  isWorkspaceAdmin?: boolean;
  isChannelManager?: boolean;
}): { role?: string; permissions?: string[] } {
  const permissions: string[] = [];
  if (input.isWorkspaceOwner) {
    permissions.push('workspace_owner', 'workspace_admin', 'channel_manager');
    return { role: 'owner', permissions };
  }
  if (input.isWorkspaceAdmin) {
    permissions.push('workspace_admin', 'channel_manager');
    return { role: 'admin', permissions };
  }
  if (input.isChannelManager) {
    permissions.push('channel_manager');
    return { role: 'channel_admin', permissions };
  }
  return { role: 'member', permissions };
}

export function checkSlackPlatformPermit(perm: string, subject: PermissionSubject): boolean {
  // Native role names (e.g. Telegram `creator`) may still arrive until every adapter reports
  // the normalized standing (ADR 0056 §1); compare as plain strings.
  const role = subject.sender?.platform?.standing as string | undefined;
  const permissions = subject.sender?.platform?.permissions ?? [];
  // Accepts legacy UPPER_SNAKE tokens and ADR 0056 §1 snake_case platform permission names.
  const has = (t: string) => permissions.includes(t) || permissions.includes(t.toLowerCase());

  switch (perm) {
    case 'workspace_owner':
      return role === 'owner' || has('workspace_owner');
    case 'workspace_admin':
      return role === 'owner' || role === 'admin' || has('workspace_admin') || has('workspace_owner');
    case 'channel_manager':
      return role === 'owner' || role === 'admin' || role === 'channel_admin'
        || has('channel_manager') || has('workspace_admin') || has('workspace_owner');
    default:
      return false;
  }
}

