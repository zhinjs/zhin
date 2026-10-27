import { projectLocaleToken } from 'zhin.js/i18n';
import { databaseHostToken, definePlugin, outboundHostToken } from 'zhin.js';
import { pluginVerificationToken, pluginTaskProviderToken } from 'zhin.js/plugin-runtime';
import { randomUUID } from 'node:crypto';
import { assertReminderTimezone, type ReminderConfig } from './src/config.js';
import { createReminderState } from './src/storage.js';
import { ReminderService } from './src/service.js';
import { reminderServiceToken } from './src/runtime.js';

export default definePlugin<ReminderConfig>({
  name: 'reminder',
  metadata: { displayName: '持久提醒' },
  requires: [databaseHostToken, outboundHostToken],
  setup(context) {
    const config = context.config.get();
    assertReminderTimezone(config.timezone);
    const database = context.resources.use(databaseHostToken);
    const state = database.state;
    const taskState = createReminderState(database);
    const outbound = context.resources.use(outboundHostToken);
    if (!outbound.sendTarget) throw new Error('提醒需要支持精确 DeliveryTarget 的 Outbound Host');
    const service = new ReminderService(taskState, outbound, config, context.resources.use(projectLocaleToken));
    context.resources.provide(reminderServiceToken, service);
    context.resources.provide(pluginTaskProviderToken, service.administratorTasks);
    context.resources.provide(pluginVerificationToken, {
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
    });
    return () => service.stop();
  },
});
