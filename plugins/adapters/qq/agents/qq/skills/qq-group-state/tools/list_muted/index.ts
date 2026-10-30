import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentGroup } from '../../../../conversation.js';

export default defineAgentTool({
  description: '查询当前 QQ 群的禁言状态：全员禁言规则与被禁言成员列表',
  adapter: 'qq',
  scopes: ['group'],
  requiresApproval: 'never',
  readOnly: true,
  inputSchema: z.object({}),
  async execute(_input, context) {
    const setting = await context.$client.groupService.getMuteSetting(currentGroup(context));
    const now = Date.now();
    const muted = (setting.members ?? []).filter((m) => {
      const until = Date.parse(m.mute_expire_at);
      return !Number.isFinite(until) || until > now;
    });
    return { global_rule: setting.global_rule, muted_members: muted, count: muted.length };
  },
});
