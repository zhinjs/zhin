import { definePage, definePageBlueprint } from '@zhin.js/console-contract';
import type { LotteryConsoleStatus } from '../../plugin.js';

export const meta = definePage({
  title: '彩票推荐',
  titleI18n: { en: 'Lottery' },
  icon: 'Sparkles',
  order: 60,
  requiredPermissions: ['lottery:read'],
});

export default definePageBlueprint<LotteryConsoleStatus>({
  title: { zh: '彩票推荐', en: 'Lottery' },
  description: {
    zh: '查看多彩种推荐配置与每日流水线计划',
    en: 'Review the lottery game configuration and the daily recommendation schedule',
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
  ],
  sections: [
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
