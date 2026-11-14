import { definePage, definePageBlueprint } from '@zhin.js/console-contract';
import type { CalendarConsoleEventItem } from '../../plugin.js';

export interface CalendarConsoleStatus {
  readonly provider: 'none' | 'google' | 'microsoft' | 'caldav';
  readonly timezone: string;
  readonly ready: boolean;
  readonly oauthCallbackPath: string;
  readonly workingHours: string;
  readonly eventCount?: number;
  readonly events?: readonly CalendarConsoleEventItem[];
}

export const meta = definePage({
  title: '日历日程',
  titleI18n: { en: 'Calendar' },
  icon: 'Calendar',
  order: 53,
  requiredPermissions: ['calendar:read'],
});

export default definePageBlueprint<CalendarConsoleStatus>({
  title: { zh: '日历日程', en: 'Calendar' },
  description: {
    zh: '查看日历后端连接状态、时区与工作时间范围，并在线新建或管理日程',
    en: 'View calendar provider status, timezone, and working hours configuration, and create or manage events',
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
  actions: [
    {
      name: 'create',
      label: { zh: '新建日程', en: 'Create Event' },
      variant: 'primary',
      fields: [
        {
          key: 'title',
          label: { zh: '日程标题', en: 'Event Title' },
          type: 'text',
          required: true,
        },
        {
          key: 'date',
          label: { zh: '日期', en: 'Date' },
          type: 'date',
          required: true,
        },
        {
          key: 'time',
          label: { zh: '时间', en: 'Time' },
          type: 'time',
          defaultValue: '09:00',
        },
        {
          key: 'repeat',
          label: { zh: '重复周期', en: 'Repeat' },
          type: 'select',
          defaultValue: 'none',
          options: [
            { value: 'none', label: { zh: '不重复 (none)', en: 'None' } },
            { value: 'daily', label: { zh: '每天 (daily)', en: 'Daily' } },
            { value: 'weekly', label: { zh: '每周 (weekly)', en: 'Weekly' } },
            { value: 'monthly', label: { zh: '每月 (monthly)', en: 'Monthly' } },
            { value: 'yearly', label: { zh: '每年 (yearly)', en: 'Yearly' } },
          ],
        },
      ],
    },
  ],
  sections: [
    {
      id: 'events',
      layout: 'table',
      title: { zh: '日程列表', en: 'Calendar Events' },
      emptyText: { zh: '暂无日程记录', en: 'No calendar events yet' },
      items: 'events',
      rowKey: 'id',
      // Delete from the row itself; no event ID to copy by hand.
      rowActions: [
        {
          name: 'delete',
          label: { zh: '删除', en: 'Delete' },
          variant: 'danger',
          confirm: { zh: '确认删除该日程？', en: 'Delete this event?' },
          confirmLabel: { zh: '删除', en: 'Delete' },
          idParamKey: 'id',
          successMessage: { zh: '已删除日程', en: 'Event deleted' },
        },
      ],
      columns: [
        { key: 'id', label: { zh: 'ID', en: 'ID' } },
        { key: 'title', label: { zh: '日程标题', en: 'Title' } },
        { key: 'date', label: { zh: '日期', en: 'Date' } },
        { key: 'time', label: { zh: '时间', en: 'Time' } },
        { key: 'repeat', label: { zh: '重复', en: 'Repeat' } },
      ],
    },
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
