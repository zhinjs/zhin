/**
 * Slack platform permit — workspace + channel 权限
 */
import { registerPlatformPermitChecker, type Message } from '@zhin.js/core';

const ADAPTER = 'slack';

export function platformPermit(perm: string): string {
  return `platform(${ADAPTER},${perm})`;
}

const FACTORY_PERM_MAP: Record<string, string> = {
  scene_admin: 'channel_manager',
  scene_owner: 'workspace_owner',
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

export function checkSlackPlatformPermit(perm: string, message: Message<any>): boolean {
  const sender = message.$sender as { role?: string; permissions?: string[] };
  const permissions = sender.permissions ?? [];
  const role = sender.role;
  const has = (t: string) => permissions.includes(t);

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

export function registerSlackPlatformPermitChecker(): () => void {
  return registerPlatformPermitChecker(ADAPTER, checkSlackPlatformPermit);
}
