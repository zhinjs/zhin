import { definePage, definePageBlueprint } from '@zhin.js/console-contract';
import type { LotteryConsoleStatus, LotteryTestDrawItem } from '../../plugin.js';

export const meta = definePage({
  title: '彩票与抽签',
  titleI18n: { en: 'Lottery' },
  icon: 'Sparkles',
  order: 60,
  requiredPermissions: ['lottery:read'],
});

export default definePageBlueprint<LotteryConsoleStatus>({
  title: { zh: '彩票与抽签', en: 'Lottery' },
  description: {
    zh: '管理多彩种推荐配置、每日流水线状态与在线模拟抽签测试',
    en: 'Manage lottery game configuration, daily recommendation pipeline, and test draws',
  },
  stats: [
    {
      key: 'enabledGamesCount',
      label: { zh: '启用彩种数', en: 'Enabled Games' },
      value: 'enabledGamesCount',
    },
    {
      key: 'pickCount',
      label: { zh: '单次推荐注数', en: 'Pick Count' },
      value: 'pickCount',
    },
    {
      key: 'recentTestCount',
      label: { zh: '模拟抽签次数', en: 'Test Draws' },
      value: 'recentTestCount',
    },
  ],
  actions: [
    {
      name: 'drawTest',
      label: { zh: '模拟抽签测试', en: 'Test Draw' },
      description: {
        zh: '执行一次签池运势与幸运号码模拟抽取',
        en: 'Run a simulated fortune and lucky number test draw',
      },
      variant: 'primary',
      fields: [
        {
          key: 'userId',
          label: { zh: '测试用户 ID (可选)', en: 'User ID (Optional)' },
          type: 'text',
          defaultValue: 'console-tester',
        },
      ],
    },
  ],
  sections: [
    {
      id: 'recentDraws',
      layout: 'table',
      title: { zh: '模拟抽签记录', en: 'Recent Test Draws' },
      emptyText: { zh: '暂无模拟抽签记录', en: 'No test draws yet' },
      items: 'recentDraws',
      columns: [
        { key: 'createdAt', label: { zh: '抽取时间', en: 'Created At' } },
        { key: 'userId', label: { zh: '用户 ID', en: 'User ID' } },
        { key: 'fortune', label: { zh: '签位运势', en: 'Fortune' } },
        { key: 'numbers', label: { zh: '幸运号码', en: 'Lucky Numbers' } },
      ] satisfies readonly {
        readonly key: keyof LotteryTestDrawItem & string;
        readonly label: { readonly zh: string; readonly en: string };
      }[],
    },
    {
      id: 'config',
      title: { zh: '配置详情', en: 'Configuration Details' },
      entries: [
        { label: 'scheduleCron', dataKey: 'scheduleCron' },
        { label: 'historyLimit', dataKey: 'historyLimit' },
        { label: 'pickCount', dataKey: 'pickCount' },
      ],
    },
  ],
});
