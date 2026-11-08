import { definePage, createDeclarativePage } from '@zhin.js/console-contract';

export interface CalendarConsoleStatus {
  readonly provider: 'none' | 'google' | 'microsoft' | 'caldav';
  readonly timezone: string;
  readonly ready: boolean;
  readonly oauthCallbackPath: string;
  readonly workingHours: string;
}

export const meta = definePage({
  title: '日历日程',
  titleI18n: { en: 'Calendar' },
  icon: 'Calendar',
  order: 53,
  requiredPermissions: ['calendar:read'],
});

export default createDeclarativePage<CalendarConsoleStatus>({
  title: { zh: '日历日程', en: 'Calendar' },
  description: {
    zh: '查看日历后端连接状态、时区与工作时间范围',
    en: 'View calendar provider status, timezone, and working hours configuration',
  },
  dictionary: {
    '已就绪': 'Ready',
    '未就绪': 'Not ready',
  },
  badges: [
    {
      key: 'ready',
      label: {
        $map: {
          path: 'ready',
          cases: {
            true: { zh: '已就绪', en: 'Ready' },
            false: { zh: '未就绪', en: 'Not ready' },
          },
          default: { zh: '未就绪', en: 'Not ready' },
        },
      },
      tone: {
        $map: {
          path: 'ready',
          cases: {
            true: 'success',
            false: 'warning',
          },
          default: 'warning',
        },
      },
    },
  ],
  stats: [
    {
      key: 'provider',
      label: { zh: '日历后端', en: 'Provider' },
      value: 'provider',
    },
    {
      key: 'timezone',
      label: { zh: '时区', en: 'Timezone' },
      value: 'timezone',
    },
    {
      key: 'workingHours',
      label: { zh: '工作时段', en: 'Working Hours' },
      value: 'workingHours',
    },
  ],
  sections: [
    {
      id: 'overview',
      title: { zh: '配置概览', en: 'Configuration Overview' },
      entries: [
        { label: 'provider', dataKey: 'provider' },
        { label: 'timezone', dataKey: 'timezone' },
        { label: 'ready', dataKey: 'ready' },
        { label: 'oauthCallbackPath', dataKey: 'oauthCallbackPath' },
        { label: 'workingHours', dataKey: 'workingHours' },
      ],
    },
  ],
});
