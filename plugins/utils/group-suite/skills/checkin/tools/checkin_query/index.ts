import { messages as t } from '../../../../src/i18n.js';
import { conversationKey, toolGroupConversation } from '../../../../src/conversation-scope.js';
import { defineAgentTool } from '@zhin.js/tool';
import { getCheckinModel } from '../../../../src/db-store.js';
import { groupSuiteRuntimeToken } from '../../../../src/runtime-state.js';
import { todayStr } from '../../../../src/shared-runtime.js';

export default defineAgentTool<{ user_id?: string; group_id?: string }>({
  description: '查询用户的签到积分，或汇总当前范围的签到数据',
  inputSchema: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: '用户 ID；省略时返回汇总' },
      group_id: { type: 'string', description: '群 ID；省略时使用当前 IM 会话' },
    },
  },
  requiresApproval: 'never',
  scopes: ['group'],
  async execute({ user_id: userId, group_id: requestedGroupId }, context) {
    const runtime = context.use(groupSuiteRuntimeToken);
    const model = getCheckinModel(runtime.db);
    if (!model) return t(context.locale, 'checkinDb');
    const groupId = conversationKey(toolGroupConversation(context, requestedGroupId));
    const query = {
      ...(userId ? { user_id: userId } : {}),
      context_type: 'group', context_id: groupId,
    };
    const rows = await model.select().where(query);
    if (userId) {
      if (rows.length === 0) return t(context.locale, 'userCheckinEmpty', { user: userId });
      const user = rows[0]!;
      return t(context.locale, 'userCheckinInfo', { name: String(user.user_name ?? userId), points: Number(user.points ?? 0), total: Number(user.total_checkins ?? 0), streak: Number(user.streak ?? 0), max: Number(user.max_streak ?? 0), last: String(user.last_checkin ?? '') });
    }
    const totalPoints = rows.reduce((sum, user) => sum + Number(user.points ?? 0), 0);
    const todayCount = rows.filter((user) => user.last_checkin === todayStr()).length;
    return t(context.locale, 'checkinOverview', { users: rows.length, points: totalPoints, today: todayCount });
  },
});
