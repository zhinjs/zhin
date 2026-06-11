/**
 * 内置 permit 同步校验（adapter/group/private/channel/user/role）
 */
import type { Message } from '../message.js';
import type { SenderRole } from './roles.js';
import { isFrameworkSenderRole, roleSatisfies } from './roles.js';
import { parsePermitName } from './permit-parse.js';

function channelIdMatches(id: string, channelId: string): boolean {
  return id === '' || id === '*' || channelId === id;
}

export function checkBuiltinPermit(
  name: string,
  message: Message<any>,
  roles: readonly SenderRole[],
): boolean {
  const parsed = parsePermitName(name);
  if (!parsed) return false;

  switch (parsed.kind) {
    case 'adapter':
      return parsed.values.some((v) => message.$adapter === v);
    case 'group':
      if (message.$channel?.type !== 'group') return false;
      return parsed.values.some((id) => channelIdMatches(id, String(message.$channel.id)));
    case 'private':
      if (message.$channel?.type !== 'private') return false;
      return parsed.values.some((id) => channelIdMatches(id, String(message.$channel.id)));
    case 'channel':
      if (message.$channel?.type !== 'channel') return false;
      return parsed.values.some((id) => channelIdMatches(id, String(message.$channel.id)));
    case 'user':
      return parsed.values.some((id) => String(message.$sender.id) === id);
    case 'role':
      return parsed.values.some((req) =>
        isFrameworkSenderRole(req) && roleSatisfies(roles, [req]),
      );
    default:
      return false;
  }
}

export function checkBuiltinPermitList(
  permits: readonly string[],
  message: Message<any>,
  roles: readonly SenderRole[],
): boolean {
  return permits.every((p) => checkBuiltinPermit(p, message, roles));
}
