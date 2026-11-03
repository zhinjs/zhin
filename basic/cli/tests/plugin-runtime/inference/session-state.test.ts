import { join } from 'node:path';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { PersonalSessionService, personalSessionIdentity, personalSessionOwnerId } from '@zhin.js/agent/personal-session';
import { InferenceSessionRepository } from '../../../src/plugin-runtime/inference/session-state.js';
import { InferenceSessionManagement } from '../../../src/plugin-runtime/inference/session-management.js';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { setupInferenceManagement } from './fixtures.js';

const address = { rootId: '/root', platform: 'qq', endpoint: 'account', subjectId: 'alice',
  conversation: { endpoint: { adapter: 'icqq', id: 'root/qq' }, kind: 'group' as const, id: 'group', parent: { kind: 'group' as const, id: 'parent' }, threadId: 'thread' } };
const identity = personalSessionIdentity(address), ownerId = personalSessionOwnerId(identity.owner);

it('persists an incarnation-bound Profile selection in real SQLite and restores it after reopening the Host database', async () => {
  const fixture = await setupInferenceManagement();
  let reopened: ReturnType<typeof createDatabaseHost> | undefined;
  try {
    const service = new PersonalSessionService(new InferenceSessionRepository(() => fixture.db.state));
    const selected = await service.select({ address, owner: identity.owner, expectedRevision: 0,
      selection: { kind: 'profile', profile: { id: 'profile', rootId: '/root', accountId: 'account', accountIncarnation: 'first', kind: 'language' } } });
    await fixture.db.stop();
    reopened = createDatabaseHost({ dialect: 'sqlite', filename: join(fixture.directory, 'state.sqlite') });
    await reopened.start();
    const restored = new PersonalSessionService(new InferenceSessionRepository(() => reopened!.state));
    expect(await restored.read({ address, owner: identity.owner })).toEqual(selected);
    await expect(restored.select({ address, owner: identity.owner, expectedRevision: 0, selection: { kind: 'inherit' } }))
      .rejects.toMatchObject({ name: 'PersonalSessionRevisionConflictError' });
  } finally { await reopened?.stop(); await fixture.close(); }
});

it('keeps legacy Session records intact and reports explicit migration instead of treating them as inheritance', async () => {
  const fixture = await setupInferenceManagement();
  try {
    const port = fixture.db.state!;
    await port.compareExchange(rootPluginId(), { kind: 'plugin' }, identity.key, undefined,
      { version: 1, kind: 'personal-session', state: { revision: 1, selection: { kind: 'preset', presetId: 'legacy' } } }, null);
    const store = new InferenceSessionRepository(() => port);
    await expect(store.read(identity)).rejects.toMatchObject({ code: 'migration-required' });
    expect((await port.read(rootPluginId(), { kind: 'plugin' }, identity.key))?.value).toMatchObject({ version: 1, state: { selection: { presetId: 'legacy' } } });
  } finally { await fixture.close(); }
});

it('checks the real personal owner, current language capability and account incarnation before writing a Session selection', async () => {
  const fixture = await setupInferenceManagement();
  try {
    const sessions = new PersonalSessionService(new InferenceSessionRepository(() => fixture.db.state));
    const management = new InferenceSessionManagement({ rootId: '/root', hostOwnerId: 'host', owners: [identity.owner], sessions,
      repository: fixture.repository, directory: async () => ({ rows: [], hasMore: false }) });
    const principal = { ownerId, hostAdministrator: false };
    const selected = { kind: 'profile', profile: { id: 'profile', rootId: '/root', accountId: 'account', accountIncarnation: 'first', kind: 'language' } };
    expect(await management.select(principal, { address, expectedRevision: 0, selection: selected })).toMatchObject({ revision: 1, selection: selected });
    await expect(management.select(principal, { address: { ...address, subjectId: 'another' }, expectedRevision: 0, selection: selected })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(management.select(principal, { address, expectedRevision: 1, selection: { ...selected, profile: { ...selected.profile, accountIncarnation: 'different' } } })).rejects.toMatchObject({ code: 'stale-reference' });
    expect((await sessions.read({ address, owner: identity.owner })).revision).toBe(1);
  } finally { await fixture.close(); }
});
