import { definePage, createDeclarativePage } from '@zhin.js/console-contract';
import type { ReminderConsoleItem, ReminderConsoleSnapshot } from '../../src/service.js';

export const meta = definePage({
  title: '持久提醒',
  titleI18n: { en: 'Reminders' },
  icon: 'Bell',
  order: 51,
  requiredPermissions: ['reminder:read'],
});

export default createDeclarativePage<ReminderConsoleSnapshot>({
  title: { zh: '持久提醒', en: 'Reminders' },
  description: {
    zh: '当前实例活跃提醒列表与运行配额状态。',
    en: 'Active personal reminders and runtime quota configuration.',
  },
  stats: [
    {
      key: 'activeCount',
      label: { zh: '活跃提醒数', en: 'Active Reminders' },
      value: 'activeCount',
    },
    {
      key: 'timezone',
      label: { zh: '显示时区', en: 'Timezone' },
      value: 'timezone',
    },
    {
      key: 'maxPerUser',
      label: { zh: '单用户上限', en: 'Max Per User' },
      value: 'maxPerUser',
    },
  ],
  sections: [
    {
      id: 'reminders',
      title: { zh: '活跃提醒列表', en: 'Active Reminders' },
      emptyText: { zh: '暂无活跃提醒任务', en: 'No active reminders.' },
      items: 'reminders',
      columns: [
        { key: 'id', label: { zh: '提醒 ID', en: 'ID' } },
        { key: 'text', label: { zh: '提醒内容', en: 'Text' } },
        { key: 'nextFireAt', label: { zh: '下次触发时间', en: 'Next Fire At' } },
        { key: 'intervalMs', label: { zh: '间隔 (ms)', en: 'Interval (ms)' } },
      ] satisfies readonly { readonly key: keyof ReminderConsoleItem & string; readonly label: { readonly zh: string; readonly en: string } }[],
    },
  ],
});
