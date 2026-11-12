/**
 * Test helper: chat roles (ADR 0056) seeded from a configuration document's legacy people lists,
 * exactly as the first-start migration would write them into chat_roles.
 */
import { ChatRoleService } from '@zhin.js/core';
import { ChatRoleStore, type InstanceChatRoleService } from '../../src/instance/chat-roles.js';
import { readLegacyChatRoleConfig } from '../../src/instance/chat-role-migration.js';

export async function chatRolesFromDocument(document: Readonly<Record<string, unknown>>): Promise<InstanceChatRoleService> {
  const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore() });
  for (const grant of readLegacyChatRoleConfig(document).grants) await roles.store.grant(grant);
  return roles;
}
