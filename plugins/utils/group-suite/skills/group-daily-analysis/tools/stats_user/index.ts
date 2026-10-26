import { messages as t } from '../../../../src/i18n.js';
import { conversationKey, toolGroupConversation } from '../../../../src/conversation-scope.js';
import { defineAgentTool } from '@zhin.js/tool';
import { getStatsModel } from '../../../../src/db-store.js';
import { groupSuiteRuntimeToken } from '../../../../src/runtime-state.js';
import { todayStr } from '../../../../src/shared-runtime.js';
import { flushStatsBuffer, weekStartStr } from '../../../../src/stats-lib.js';

export default defineAgentTool<{ user_id: string; group_id?: string }>({
  description: '查询指定用户在当前群或指定群的消息统计',
  inputSchema: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: '用户 ID' },
      group_id: { type: 'string', description: '群 ID；省略时使用当前 IM 会话' },
    },
    required: ['user_id'],
  },
  requiresApproval: 'never',
  scopes: ['group'],
  async execute({ user_id: userId, group_id: requestedGroupId }, context) {
    const runtime = context.use(groupSuiteRuntimeToken);
    await flushStatsBuffer(runtime);
    const model = getStatsModel(runtime.db);
    if (!model) return t(context.locale, 'statsDb');
    const groupId = conversationKey(toolGroupConversation(context, requestedGroupId));
    const rows = await model.select().where({
      user_id: userId,
      group_id: groupId,
    });
    if (rows.length === 0) return t(context.locale, 'userStatsEmpty', { user: userId });
    const today = todayStr();
    const weekStart = weekStartStr();
    let todayCount = 0;
    let weekCount = 0;
    let totalCount = 0;
    for (const row of rows) {
      const count = Number(row.count ?? 0);
      totalCount += count;
      if (String(row.date) >= weekStart) weekCount += count;
      if (row.date === today) todayCount += count;
    }
    const name = String(rows[0]!.user_name ?? userId);
    return t(context.locale, 'userStatsInfo', { name, today: todayCount, week: weekCount, total: totalCount, days: rows.length });
  },
});
