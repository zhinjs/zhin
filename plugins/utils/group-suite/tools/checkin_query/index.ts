import { defineAgentTool } from '@zhin.js/tool';
import { getCheckinModel } from '../../src/db-store.js';
import { groupSuiteRuntimeToken } from '../../src/runtime-state.js';
import { todayStr } from '../../src/shared-runtime.js';

export default defineAgentTool<{ user_id?: string; group_id?: string }>({
  description: '查询用户的签到积分，或汇总当前范围的签到数据',
  inputSchema: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: '用户 ID；省略时返回汇总' },
      group_id: { type: 'string', description: '群 ID；省略时使用当前 IM 会话' },
    },
  },
  approval: 'never',
  async execute({ user_id: userId, group_id: requestedGroupId }, context) {
    const runtime = context.use(groupSuiteRuntimeToken);
    const model = getCheckinModel(runtime.db);
    if (!model) return '签到数据库尚未就绪';
    const groupId = requestedGroupId ?? currentGroupId(context.origin);
    const query = {
      ...(userId ? { user_id: userId } : {}),
      ...(groupId ? { context_type: 'group', context_id: groupId } : {}),
    };
    const rows = Object.keys(query).length > 0
      ? await model.select().where(query)
      : await model.select();
    if (userId) {
      if (rows.length === 0) return `用户 ${userId} 没有签到记录`;
      const user = rows[0]!;
      return `${String(user.user_name ?? userId)}: 积分=${Number(user.points ?? 0)}, 累计=${Number(user.total_checkins ?? 0)}天, 连续=${Number(user.streak ?? 0)}天, 最长=${Number(user.max_streak ?? 0)}天, 上次=${String(user.last_checkin ?? '')}`;
    }
    const totalPoints = rows.reduce((sum, user) => sum + Number(user.points ?? 0), 0);
    const todayCount = rows.filter((user) => user.last_checkin === todayStr()).length;
    return `签到系统统计\n总用户: ${rows.length}\n总积分: ${totalPoints}\n今日签到: ${todayCount}人`;
  },
});

function currentGroupId(origin: import('@zhin.js/tool').ToolInvocationOrigin): string {
  return origin.kind === 'im' && origin.scope !== 'private' ? origin.sceneId : '';
}
