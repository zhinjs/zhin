import { projectLocaleToken, type Locale } from 'zhin.js/i18n';
import {
  databaseHostToken,
  definePlugin,
  definePluginCapabilityGraph,
  outboundHostToken,
  pluginConsoleRpcToken,
  pluginTaskProviderToken,
  pluginVerificationToken,
} from 'zhin.js';
import { randomUUID } from 'node:crypto';
import { assertReminderTimezone, type ReminderConfig } from './src/config.js';
import { createReminderConsoleRpc } from './src/console.js';
import { createReminderState } from './src/storage.js';
import { ReminderService } from './src/service.js';
import { reminderServiceToken } from './src/runtime.js';

export default definePlugin<ReminderConfig>({
  name: 'reminder',
  requires: [databaseHostToken, outboundHostToken],
  capabilityGraph: definePluginCapabilityGraph({
    provides: [
      reminderServiceToken,
      pluginConsoleRpcToken,
      pluginTaskProviderToken,
      pluginVerificationToken,
    ],
    injects: [databaseHostToken, outboundHostToken, projectLocaleToken],
    features: {
      commands: [
        'remind/after',
        'remind/at',
        'remind/cancel',
        'remind/create',
        'remind/every',
        'remind/list',
      ],
      schedules: ['poll'],
      skills: ['reminder'],
      tools: [
        'skill/reminder/reminder_cancel',
        'skill/reminder/reminder_create',
        'skill/reminder/reminder_list',
      ],
      pages: ['index'],
    },
  }),
  setup(context) {
    const config = context.config.get();
    assertReminderTimezone(config.timezone);
    const database = context.resources.use(databaseHostToken);
    const state = database.state;
    const taskState = createReminderState(database);
    const outbound = context.resources.use(outboundHostToken);
    if (!outbound.sendTarget) throw new Error('提醒需要支持精确 DeliveryTarget 的 Outbound Host');
    let locale: Locale | undefined;
    try {
      locale = context.resources.use(projectLocaleToken);
    } catch {
      locale = undefined;
    }
    // ADR 0050 / 0055: deliveries are not messages, so check the switch of each target conversation.
    const service = new ReminderService(taskState, outbound, config, locale, target => context.isEnabledFor({ conversation: target }));
    reminderServiceToken.provide(context, service);
    return {
      consoleRpc: createReminderConsoleRpc(service),
      tasks: service.administratorTasks,
      verification: {
        checks: () => [{ id: 'local-state', title: '持久状态读写检查', titleI18n: { en: 'Persistent state read/write check' }, scope: 'local',
          effects: ['写入、读取并删除一个独立探针键；不创建提醒、不发送消息'],
          effectsI18n: { en: ['Write, read and delete an isolated probe key; no reminders are created and no messages are sent'] } }],
        async run(checkId) {
          if (checkId !== 'local-state') throw new Error('Unknown reminder verification check');
          const key = `verification/${randomUUID()}`;
          try {
            await state.set(key, { probe: true }, { ttlMs: 60_000 });
            const value = await state.get<{ probe: boolean }>(key);
            if (value?.probe !== true) throw new Error('持久状态读写结果不一致');
            return { status: 'passed', summary: '本地持久状态读写通过', summaryI18n: { en: 'Local persistent state read/write check passed' },
              evidence: ['独立探针写入并成功读回；清理后删除', '仅验证当前 owner 的数据库状态；不证明调度或平台投递健康'],
              evidenceI18n: { en: ['An isolated probe was written, read back and deleted during cleanup', 'Checks only this owner’s database state; does not verify scheduling or platform delivery'] } };
          } finally { await state.delete(key); }
        },
      },
    };
  },
});
