import { defineAgentTool } from '@zhin.js/tool';
import { groupSuiteRuntimeToken } from '../../../../src/runtime-state.js';
import { flushStatsBuffer, monthStartStr, queryStats, weekStartStr } from '../../../../src/stats-lib.js';
import { todayStr } from '../../../../src/shared-runtime.js';

type Period = 'today' | 'week' | 'month';

export default defineAgentTool<{ group_id?: string; period?: Period }>({
  description: '查询当前群或指定群的消息统计',
  inputSchema: {
    type: 'object',
    properties: {
      group_id: { type: 'string', description: '群 ID；省略时使用当前 IM 会话' },
      period: { type: 'string', enum: ['today', 'week', 'month'], description: '统计时段' },
    },
  },
  approval: 'never',
  async execute({ group_id: requestedGroupId, period = 'today' }, context) {
    const runtime = context.use(groupSuiteRuntimeToken);
    await flushStatsBuffer(runtime);
    const groupId = requestedGroupId
      ?? (context.origin.kind === 'im' && context.origin.scope !== 'private'
        ? context.origin.sceneId
        : '');
    const fromDate = period === 'week'
      ? weekStartStr()
      : period === 'month' ? monthStartStr() : todayStr();
    const stats = await queryStats(groupId, fromDate, runtime);
    if (stats.size === 0) return `${period} 暂无消息统计数据`;
    const ranked = [...stats.values()].sort((left, right) => right.count - left.count);
    const total = ranked.reduce((sum, item) => sum + item.count, 0);
    const lines = ranked.slice(0, 10)
      .map((item, index) => `${index + 1}. ${item.name} — ${item.count}条`);
    return `消息统计 (${period})\n总消息: ${total}条, 活跃用户: ${stats.size}人\n${lines.join('\n')}`;
  },
});
