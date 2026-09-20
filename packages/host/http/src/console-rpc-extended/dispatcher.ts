import { assertDemoConsoleRpcAllowed } from '@zhin.js/console-protocol';
import type { ConsoleRpcExtendedCtx, ExtendedRpcResult } from './contracts.js';
import { addCron, listSchedule, mutateCron } from './schedule-rpc.js';
import {
  actOnRequest, listInbox, listInboxMessages, listPendingRequests, listRecentInboxMessages,
  mapNoticeRow, mapRequestRow, markInboxConsumed, TABLE_NOTICE, TABLE_REQUEST,
} from './inbox-rpc.js';
import { cancelLogin, listLoginPending, submitLogin } from './login-rpc.js';
import {
  deleteFriend, groupWriteOp, listChannels, listFriends, listGroupMembers, listGroups,
} from './endpoint-rpc.js';
import { mutateWorkroomKnowledge, mutateWorkroomProfile } from './workroom-rpc.js';

export async function dispatchExtendedConsoleRpc(
  type: string,
  data: Record<string, unknown> | undefined,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult | undefined> {
  const d = data ?? {};

  if (!ctx.fullScope) {
    const denied = assertDemoConsoleRpcAllowed(type);
    if (denied) return { error: denied };
  }

  switch (type) {
    case 'schedule:list':
    case 'cron:list':
      return listSchedule(ctx);

    case 'cron:add':
      return addCron(d, ctx);
    case 'cron:remove':
    case 'cron:pause':
    case 'cron:resume':
      return mutateCron(type, d, ctx);

    case 'request.list':
      return listPendingRequests(d, ctx);
    case 'inbox.requests':
      return listInbox(d, ctx, TABLE_REQUEST, 'requests', mapRequestRow);
    case 'inbox.notices':
      return listInbox(d, ctx, TABLE_NOTICE, 'notices', mapNoticeRow);
    case 'inbox.messages':
      return listInboxMessages(d, ctx);
    case 'inbox.recent':
      return listRecentInboxMessages(d, ctx);

    case 'request.approve':
    case 'request.reject':
      return actOnRequest(type, d, ctx);

    case 'login.list':
      return listLoginPending(ctx);
    case 'login.submit':
      return submitLogin(d, ctx);
    case 'login.cancel':
      return cancelLogin(d, ctx);

    case 'request.consumed':
      return markInboxConsumed(d, ctx, TABLE_REQUEST);
    case 'notice.consumed':
      return markInboxConsumed(d, ctx, TABLE_NOTICE);

    case 'endpoint.friends':
      return listFriends(d, ctx);
    case 'endpoint.groups':
      return listGroups(d, ctx);
    case 'endpoint.channels':
      return listChannels(d, ctx);
    case 'endpoint.group_members':
      return listGroupMembers(d, ctx);

    case 'endpoint.group_kick':
      return groupWriteOp(d, ctx, {
        method: 'kickGroupMember',
        buildArgs: (gid, uid) => [gid, uid],
        requireUser: true,
        unsupported: '踢出群成员',
      });
    case 'endpoint.group_mute':
      return groupWriteOp(d, ctx, {
        method: 'muteGroupMember',
        buildArgs: (gid, uid, extra) => [gid, uid, extra.duration ?? 600],
        requireUser: true,
        unsupported: '禁言群成员',
      });
    case 'endpoint.group_admin':
      return groupWriteOp(d, ctx, {
        method: 'setGroupAdmin',
        buildArgs: (gid, uid, extra) => [gid, uid, extra.enable !== false],
        requireUser: true,
        unsupported: '设置群管理员',
      });
    case 'endpoint.delete_friend':
      return deleteFriend(d, ctx);

    case 'workroom.profile.status':
    case 'workroom.profile.bootstrap':
    case 'workroom.profile.pack.publish':
    case 'workroom.profile.publish':
    case 'workroom.profile.rollback':
    case 'workroom.profile.policy.publish':
      return mutateWorkroomProfile(type, d, ctx);

    case 'workroom.knowledge.get':
    case 'workroom.knowledge.publish':
    case 'workroom.knowledge.rollback':
      return mutateWorkroomKnowledge(type, d, ctx);

    default:
      return undefined;
  }
}
