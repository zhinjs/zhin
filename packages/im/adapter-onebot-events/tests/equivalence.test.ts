import { describe, expect, it } from 'vitest';
import { receiveOneBotLikeSideEvent } from '../src/dispatch.js';
import { mapNoticeParts } from '../src/normalize.js';

async function canonical(platform: string, raw: Record<string, unknown>) {
  const emitted: Array<Record<string, any>> = [];
  await receiveOneBotLikeSideEvent(async (_name, payload) => { emitted.push(payload as never); }, {
    adapter: platform,
    endpointKey: 'bot',
    platform,
    raw: { post_type: 'notice', time: 1_700_000_000, group_id: 1, ...raw },
  });
  const { name, actor, target, operation, reaction, durationSeconds, role, enabled, value, conversation } = emitted[0]!;
  return { name, actor, target, operation, reaction, durationSeconds, role, enabled, value, conversation };
}

// 同一语义事件在 OneBot v11 / NapCat 用下划线 notice_type，在 icqq 用 notice_type=group + sub_type；
// 经共享映射包后必须得到同一份标准事件。
const CASES: Array<{ label: string; name: string; onebot: Record<string, unknown>; icqq: Record<string, unknown> }> = [
  {
    label: 'join',
    name: 'notice.group.member_increase',
    onebot: { notice_type: 'group_increase', user_id: 2, operator_id: 3 },
    icqq: { notice_type: 'group', sub_type: 'increase', user_id: 2, operator_id: 3 },
  },
  {
    label: 'leave',
    name: 'notice.group.member_decrease',
    onebot: { notice_type: 'group_decrease', user_id: 2 },
    icqq: { notice_type: 'group', sub_type: 'decrease', user_id: 2 },
  },
  {
    label: 'kick',
    name: 'notice.group.member_decrease',
    onebot: { notice_type: 'group_decrease', user_id: 2, operator_id: 9 },
    icqq: { notice_type: 'group', sub_type: 'decrease', user_id: 2, operator_id: 9 },
  },
  {
    label: 'card change',
    name: 'notice.group.card_change',
    onebot: { notice_type: 'group_card', user_id: 2, card_new: '新名片' },
    icqq: { notice_type: 'group', sub_type: 'card', user_id: 2, card_new: '新名片' },
  },
  {
    label: 'mute',
    name: 'notice.group.ban',
    onebot: { notice_type: 'group_ban', user_id: 2, operator_id: 9, duration: 600 },
    icqq: { notice_type: 'group', sub_type: 'ban', user_id: 2, operator_id: 9, duration: 600 },
  },
  {
    label: 'poke',
    name: 'notice.group.poke',
    onebot: { notice_type: 'notify', sub_type: 'poke', user_id: 2, target_id: 3 },
    icqq: { notice_type: 'group', sub_type: 'poke', user_id: 2, target_id: 3 },
  },
  {
    label: 'recall',
    name: 'notice.group.recall',
    onebot: { notice_type: 'group_recall', user_id: 2, operator_id: 9, message_id: 7 },
    icqq: { notice_type: 'group', sub_type: 'recall', user_id: 2, operator_id: 9, message_id: 7 },
  },
  {
    label: 'reaction',
    name: 'notice.group.emoji_reaction',
    onebot: { notice_type: 'group_msg_emoji_like', user_id: 2, message_id: 7, emoji_id: '76' },
    icqq: { notice_type: 'group', sub_type: 'reaction', user_id: 2, message_id: 7, emoji_id: '76' },
  },
];

describe('OneBot / NapCat / icqq produce the same canonical event', () => {
  for (const item of CASES) {
    it(item.label, async () => {
      const onebot = await canonical('onebot', item.onebot);
      const napcat = await canonical('napcat', item.onebot);
      const icqq = await canonical('icqq', item.icqq);
      expect(onebot.name).toBe(item.name);
      expect(napcat).toEqual(onebot);
      expect(icqq).toEqual(onebot);
    });
  }

  it('icqq override table falls back to the raw group/friend sub_type when unlisted', () => {
    expect(mapNoticeParts('icqq', 'group', { sub_type: 'custom' })).toEqual({ scene_type: 'group', sub_type: 'custom' });
    // 标准 OneBot 没有覆盖表：notice_type=group 走通用解析
    expect(mapNoticeParts('onebot', 'group', { sub_type: 'increase' }).scene_type).toBe('group');
  });
});
