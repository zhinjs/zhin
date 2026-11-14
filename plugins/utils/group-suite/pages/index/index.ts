import { definePage, createDeclarativePage, type DeclarativeColumnSpec } from '@zhin.js/console-contract';
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
      // Same scopes as `teach-list` and `keyword-list`, shown separately and summed.
      key: 'qaCount',
      label: { zh: '问答 + 关键词', en: 'Q&A + keywords' },
      value: 'qaCount',
      hint: {
        $format: { zh: '问答 {0} 条 · 关键词 {1} 条', en: '{0} Q&A · {1} keywords' },
        args: ['teachCount', 'keywordCount'],
      },
    },
  ],
  sections: [
    {
      id: 'topCheckins',
      title: { zh: '签到排行榜', en: 'Check-in Leaderboard' },
      emptyText: { zh: '暂无签到记录', en: 'No check-in records yet' },
      items: 'topCheckins',
      columns: [
        { key: 'user', label: { zh: '用户', en: 'User' } },
        { key: 'userId', label: { zh: '用户 ID', en: 'User ID' } },
        { key: 'groupId', label: { zh: '会话', en: 'Conversation' }, type: 'conversation' },
        { key: 'points', label: { zh: '积分', en: 'Points' } },
        { key: 'totalDays', label: { zh: '累计天数', en: 'Total Days' } },
        { key: 'streakDays', label: { zh: '连续天数', en: 'Streak Days' } },
        { key: 'lastDate', label: { zh: '最近签到', en: 'Last Date' } },
      ] satisfies readonly DeclarativeColumnSpec<GroupSuiteCheckinLeaderboardRow, GroupSuiteConsoleStatus>[],
    },
    {
      id: 'keywords',
      title: { zh: '问答与关键词回复', en: 'Q&A and Keyword Replies' },
      description: {
        zh: '「问答」来自 teach 命令，「关键词」来自 keyword-add；最多列出 50 条',
        en: '“Q&A” comes from the teach command, “keyword” from keyword-add; up to 50 rows',
      },
      emptyText: { zh: '暂无问答或关键词', en: 'No Q&A or keyword replies yet' },
      items: 'keywords',
      columns: [
        {
          key: 'kind',
          label: { zh: '类型', en: 'Type' },
          render: (value, _row, ctx) => (value === 'teach'
            ? (ctx.locale === 'en' ? 'Q&A' : '问答')
            : (ctx.locale === 'en' ? 'Keyword' : '关键词')),
        },
        { key: 'groupId', label: { zh: '会话', en: 'Conversation' }, type: 'conversation' },
        { key: 'keyword', label: { zh: '问题 / 关键词', en: 'Question / keyword' } },
        { key: 'reply', label: { zh: '回复内容', en: 'Reply' } },
        { key: 'creator', label: { zh: '创建者', en: 'Creator' } },
      ] satisfies readonly DeclarativeColumnSpec<GroupSuiteKeywordRow, GroupSuiteConsoleStatus>[],
    },
  ],
});
