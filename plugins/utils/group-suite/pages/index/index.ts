import { definePage } from '@zhin.js/console-contract';
import { createDeclarativePage } from '@zhin.js/client';
import type {
  GroupSuiteCheckinLeaderboardRow,
  GroupSuiteConsoleStatus,
  GroupSuiteKeywordRow,
} from '../../src/console.js';

export const meta = definePage({
  title: '群管套件',
  titleI18n: { en: 'Group Suite' },
  icon: 'Users',
  order: 54,
  requiredPermissions: ['group-suite:read'],
});

export default createDeclarativePage<GroupSuiteConsoleStatus>({
  title: { zh: '群管套件', en: 'Group Suite' },
  description: {
    zh: '群签到积分排行榜与关键词问答规则概览',
    en: 'Group check-in leaderboard and keyword Q&A rules overview',
  },
  stats: [
    {
      key: 'checkinCount',
      label: { zh: '签到记录数', en: 'Check-in Records' },
      value: 'checkinCount',
    },
    {
      key: 'keywordCount',
      label: { zh: '问答词条数', en: 'Keyword Rules' },
      value: 'keywordCount',
    },
  ],
  sections: [
    {
      id: 'topCheckins',
      title: { zh: '签到排行榜', en: 'Check-in Leaderboard' },
      emptyText: { zh: '暂无签到记录', en: 'No check-in records yet' },
      items: 'topCheckins',
      columns: [
        { key: 'userId', label: { zh: '用户 ID', en: 'User ID' } },
        { key: 'groupId', label: { zh: '群号 / 范围', en: 'Group ID' } },
        { key: 'points', label: { zh: '积分', en: 'Points' } },
        { key: 'totalDays', label: { zh: '累计天数', en: 'Total Days' } },
        { key: 'streakDays', label: { zh: '连续天数', en: 'Streak Days' } },
        { key: 'lastDate', label: { zh: '最近签到', en: 'Last Date' } },
      ] satisfies readonly { key: keyof GroupSuiteCheckinLeaderboardRow & string; label: { zh: string; en: string } }[],
    },
    {
      id: 'keywords',
      title: { zh: '关键词问答规则', en: 'Keyword Q&A Rules' },
      emptyText: { zh: '暂无关键词问答规则', en: 'No keyword rules configured' },
      items: 'keywords',
      columns: [
        { key: 'groupId', label: { zh: '群号 / 范围', en: 'Group ID' } },
        { key: 'keyword', label: { zh: '关键词', en: 'Keyword' } },
        { key: 'reply', label: { zh: '回复内容', en: 'Reply' } },
        { key: 'creatorId', label: { zh: '创建者', en: 'Creator ID' } },
      ] satisfies readonly { key: keyof GroupSuiteKeywordRow & string; label: { zh: string; en: string } }[],
    },
  ],
});
