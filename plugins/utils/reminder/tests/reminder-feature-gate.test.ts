import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { childPluginId, rootPluginId, PluginDatabaseHost, type DeliveryTarget } from '../../../../packages/im/plugin-runtime/src/index.js';
import { createDatabaseHost } from '../../../../packages/im/core/src/plugin-runtime/im/index.js';
import { sqliteAvailable } from '../../../../packages/im/zhin/tests/instance/sqlite-availability.js';
import { REMINDER_STATE_KEY, ReminderService, type ReminderBook } from '../src/service.js';
import type { ReminderConfig } from '../src/config.js';
import { ADMIN_REMINDER_STATE_KEY, type AdminReminderBook } from '../src/admin-tasks.js';
import configSchema from '../schema.json' with { type: 'json' };

const config: ReminderConfig = { timezone: 'UTC', maxTasks: 20, adminMaxTasks: 20, maxTasksPerSender: 10, batchSize: 5, missedGraceSeconds: 15 };
const on = { endpoint: { adapter: 'sandbox', id: 'main' }, kind: 'group', id: 'on' } as const;
const off = { endpoint: { adapter: 'sandbox', id: 'main' }, kind: 'group', id: 'off' } as const;
const temporary: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-reminder-gate-')); temporary.push(directory);
  const database = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'state.sqlite') }); await database.start();
  const state = new PluginDatabaseHost(childPluginId(rootPluginId(), 'reminder'), database).state;
  const sendTarget = vi.fn(async () => 'message-id');
  const checked: DeliveryTarget[] = [];
  const service = new ReminderService(state, { send: vi.fn(async () => null), sendTarget }, config, 'zh-CN',
    target => { checked.push(target); return target.id !== 'off'; });
  return { database, state, service, sendTarget, checked };
}

describe('reminder layered feature switch (ADR 0050 / 0055)', () => {
  it('declares all four levels with instance-wide fields kept global', () => {
    expect(configSchema['x-zhin-config']).toEqual({ levels: ['global', 'adapter', 'endpoint', 'conversation'] });
    for (const property of Object.values(configSchema.properties)) expect(property['x-zhin-config']).toMatchObject({ levels: ['global'] });
  });

  it.skipIf(!sqliteAvailable)('does not deliver chat or administrator reminders to switched-off conversations', async () => {
    const f = await fixture(); const start = 1_800_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      await f.service.add({ senderId: 'alice', target: on }, 'kept', start + 60_000, null);
      await f.service.add({ senderId: 'alice', target: off }, 'once', start + 60_000, null);
      await f.service.add({ senderId: 'alice', target: off }, 'every', start + 60_000, 120_000);
      // Administrator tasks are created through the published generation; seed the pool directly.
      await f.state.set(ADMIN_REMINDER_STATE_KEY, { version: 1, revision: randomUUID(), receipts: [], tasks: [{
        id: randomUUID(), creation: 'a'.repeat(64), target: off, text: 'admin', locale: 'zh-CN', createdAt: start, nextRunAt: start + 60_000,
        intervalMs: null, state: 'scheduled', claimId: null, lastRunAt: null, detail: '', detailKey: 'waiting' }] });
      clock.mockReturnValue(start + 60_000);
      await f.service.tick();
      expect(f.sendTarget.mock.calls.map(call => call[1])).toEqual(['⏰ 提醒：kept']);
      expect(f.checked.map(target => target.id).sort()).toEqual(['off', 'off', 'off', 'on']);
      const book = await f.state.get<ReminderBook>(REMINDER_STATE_KEY);
      const byText = Object.fromEntries(book!.tasks.map(task => [task.text, task]));
      expect(byText.once).toMatchObject({ status: 'failed', detailKey: 'featureDisabled' });
      // Recurring reminders skip the run and stay scheduled for when the switch is back on.
      expect(byText.every).toMatchObject({ status: 'pending', detailKey: 'featureDisabled', nextRunAt: start + 180_000 });
      const admin = await f.state.get<AdminReminderBook>(ADMIN_REMINDER_STATE_KEY);
      expect(admin!.tasks[0]).toMatchObject({ state: 'failed', detailKey: 'featureDisabled' });
    } finally { await f.database.stop(); }
  });
});
