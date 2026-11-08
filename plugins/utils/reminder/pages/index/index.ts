import { definePage, definePageBlueprint } from '@zhin.js/console-contract';
import type { ReminderConsoleItem, ReminderConsoleSnapshot } from '../../src/service.js';

export const meta = definePage({
  title: '持久提醒',
  titleI18n: { en: 'Reminders' },
  icon: 'Bell',
  order: 51,
  requiredPermissions: ['reminder:read'],
});

export default definePageBlueprint<ReminderConsoleSnapshot>({
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
  actions: [
    {
      name: 'create',
      label: { zh: '新建提醒', en: 'Create Reminder' },
      variant: 'primary',
      fields: [
        {
          key: 'content',
          label: { zh: '提醒内容', en: 'Reminder Content' },
          type: 'text',
          required: true,
        },
        {
          key: 'minutes',
          label: { zh: '几分钟后触发', en: 'Trigger After (minutes)' },
          type: 'number',
          defaultValue: '10',
        },
        {
          key: 'targetType',
          label: { zh: '会话类型', en: 'Target Type' },
          type: 'select',
          defaultValue: 'private',
          options: [
            { value: 'private', label: { zh: '私聊 (private)', en: 'Private' } },
            { value: 'group', label: { zh: '群聊 (group)', en: 'Group' } },
          ],
        },
        {
          key: 'targetId',
          label: { zh: '目标会话 ID', en: 'Target Conversation ID' },
          type: 'text',
          defaultValue: 'console',
        },
        {
          key: 'adapter',
          label: { zh: '平台适配器', en: 'Adapter' },
          type: 'text',
          defaultValue: 'sandbox',
        },
      ],
    },
    {
      name: 'delete',
      label: { zh: '删除提醒', en: 'Delete Reminder' },
      variant: 'danger',
      fields: [
        {
          key: 'id',
          label: { zh: '提醒 ID', en: 'Reminder ID' },
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'clearCompleted',
      label: { zh: '清理已完成', en: 'Clear Completed' },
      variant: 'secondary',
    },
  ],
  sections: [
    {
      id: 'reminders',
      layout: 'table',
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
