import { toPermissionSubject, type PermissionHost } from '@zhin.js/permission';
import type { Message } from '../plugin-runtime/im/contracts.js';
import type { Tool, ToolScope } from '../types.js';

/** Checks whether a Tool is visible to the current IM message context. */
export async function canAccessTool(
  tool: Tool,
  message?: Message,
  host?: PermissionHost | null,
): Promise<boolean> {
  if (!message) return !tool.platforms?.length && !tool.scopes?.length && !tool.permissions?.length;

  const adapter = String(message.clientAdapter ?? message.conversation.endpoint.adapter);
  const scope = message.conversation.kind as ToolScope;

  if (tool.platforms?.length && !tool.platforms.includes(adapter)) return false;
  if (tool.scopes?.length && !tool.scopes.includes(scope)) return false;
  if (!tool.permissions?.length) return true;
  if (!host) return false;

  return host.checkAll(tool.permissions, toPermissionSubject(message));
}
