import { defineAgentTool } from '@zhin.js/tool';
import { getCheckinModel } from '../src/db-store.js';
import { groupSuiteRuntimeToken } from '../src/runtime-state.js';

export default defineAgentTool<{ limit?: number; group_id?: string }>({
  description: '查询当前群或指定群的签到积分排行榜',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: '返回数量，默认 10，最多 50' },
      group_id: { type: 'string', description: '群 ID；省略时使用当前 IM 会话' },
    },
  },
  approval: 'never',
  async execute({ limit, group_id: requestedGroupId }, context) {
    const model = getCheckinModel(context.use(groupSuiteRuntimeToken).db);
    if (!model) return '签到数据库尚未就绪';
    const groupId = requestedGroupId
      ?? (context.origin.kind === 'im' && context.origin.scope !== 'private'
        ? context.origin.sceneId
        : '');
    const rows = groupId
      ? await model.select().where({ context_type: 'group', context_id: groupId })
      : await model.select();
    const count = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const ranked = [...rows]
      .sort((left, right) => Number(right.points ?? 0) - Number(left.points ?? 0))
      .slice(0, count);
    if (ranked.length === 0) return '暂无排行数据';
    return ranked.map((user, index) =>
      `${index + 1}. ${String(user.user_name ?? user.user_id)} — ${Number(user.points ?? 0)}分 (连续${Number(user.streak ?? 0)}天)`,
    ).join('\n');
  },
});
