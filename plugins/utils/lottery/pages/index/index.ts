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
    {
      key: 'scheduleEnabled',
      label: { zh: '每日定时推荐', en: 'Daily schedule' },
      value: {
        $map: {
          path: 'scheduleEnabled',
          cases: { true: { zh: '已启用', en: 'Enabled' }, false: { zh: '未启用', en: 'Disabled' } },
          default: { zh: '未启用', en: 'Disabled' },
        },
      },
      tone: 'neutral',
      badge: {
        label: {
          $map: {
            path: 'scheduleEnabled',
            cases: { true: { zh: '运行中', en: 'On' }, false: { zh: '已关闭', en: 'Off' } },
            default: { zh: '已关闭', en: 'Off' },
          },
        },
        tone: {
          $map: { path: 'scheduleEnabled', cases: { true: 'success', false: 'neutral' }, default: 'neutral' },
        },
      },
    },
  ],
  sections: [
    {
      id: 'config',
      title: { zh: '配置详情', en: 'Configuration Details' },
      entries: [
        {
          label: { zh: '定时推荐', en: 'Daily schedule' },
          value: {
            $map: {
              path: 'scheduleEnabled',
              cases: { true: { zh: '已启用', en: 'Enabled' }, false: { zh: '未启用', en: 'Disabled' } },
              default: { zh: '未启用', en: 'Disabled' },
            },
          },
        },
        {
          // Shown greyed out with 「未启用」 while scheduleEnabled is false: the cron is kept, not run.
          label: { zh: '定时 Cron', en: 'Schedule cron' },
          dataKey: 'scheduleCron',
          muted: { $map: { path: 'scheduleEnabled', cases: { false: 'true' }, default: 'false' } },
          badge: {
            label: { $map: { path: 'scheduleEnabled', cases: { false: { zh: '未启用', en: 'Disabled' } }, default: '' } },
            tone: 'neutral',
          },
        },
        { label: { zh: '历史期数', en: 'History limit' }, dataKey: 'historyLimit' },
        { label: { zh: '单次推荐注数', en: 'Pick count' }, dataKey: 'pickCount' },
      ],
    },
  ],
});
