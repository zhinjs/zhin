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
  approval: 'never',
  async execute({ user_id: userId, group_id: requestedGroupId }, context) {
    const runtime = context.use(groupSuiteRuntimeToken);
    await flushStatsBuffer(runtime);
    const model = getStatsModel(runtime.db);
    if (!model) return '统计数据库尚未就绪';
    const groupId = requestedGroupId
      ?? (context.origin.kind === 'im' && context.origin.scope !== 'private'
        ? context.origin.sceneId
        : '');
    const rows = await model.select().where({
      user_id: userId,
      ...(groupId ? { group_id: groupId } : {}),
    });
    if (rows.length === 0) return `用户 ${userId} 暂无消息记录`;
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
    return `${name} 的统计\n今日: ${todayCount}条\n本周: ${weekCount}条\n总计: ${totalCount}条\n活跃天数: ${rows.length}天`;
  },
});
