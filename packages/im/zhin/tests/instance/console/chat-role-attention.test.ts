import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyConfigPatches, type ConfigDocumentPort, type ConfigPatch } from '@zhin.js/plugin-runtime';
import { grantsAllow, type ConsoleGrant, type ConsoleScopeTarget } from '@zhin.js/console-protocol';
import { collectAttention, ATTENTION_PATHS, type AttentionChatRoles } from '../../../src/instance/console/attention.js';
import { dispatchChatRoleImportsConsoleRpc } from '../../../src/instance/console/chat-role-imports-rpc.js';
import { ChatRoleService, ChatRoleStore, type InstanceChatRoleService } from '../../../src/instance/chat-roles.js';
import { ChatRoleImportBook, prepareChatRoleMigration } from '../../../src/instance/chat-role-migration.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

const allowsFor = (grants: ConsoleGrant[]) => (permission: string, target?: ConsoleScopeTarget) => grantsAllow(grants, permission, target);
const globalIam: ConsoleGrant[] = [{ permissions: ['iam.manage', 'status.view'], scope: { kind: 'global' } }] as never;
const adapterIam: ConsoleGrant[] = [{ permissions: ['iam.manage', 'status.view'], scope: { kind: 'adapter', key: 'qq' } }] as never;

const state = (overrides: Partial<AttentionChatRoles> = {}): AttentionChatRoles => ({
  hasGlobalOwner: false, claimOpen: true, pending: [],
  imported: { at: 5, entries: [{ source: 'qq.master', adapter: 'qq', userId: 'boss', role: 'owner', level: 'endpoint', result: 'written' }] },
  ...overrides,
});

describe('chat role attention items (ADR 0060 §3 / §4)', () => {
  it('lists no-owner (with the claim hint), imported (with promote hint) and pending for a global iam.manage caller', async () => {
    const list = await collectAttention({ chatRoles: async () => state({ pending: [{ id: 'a'.repeat(24), source: 'ai.trigger.masters', adapter: 'qq', userId: 'x', role: 'owner', seenAt: 9 }] }) },
      { allows: allowsFor(globalIam), now: () => 10 });
    const kinds = list.items.map(item => item.kind);
    expect(kinds).toEqual(expect.arrayContaining(['chat-roles.no-owner', 'chat-roles.imported', 'chat-roles.import-pending']));
    const noOwner = list.items.find(item => item.kind === 'chat-roles.no-owner')!;
    expect(noOwner).toMatchObject({ severity: 'warning', source: 'chat-roles', action: { path: ATTENTION_PATHS.chatRoles } });
    expect(noOwner.detail).toContain('认领');
    // The item never carries the claim code itself.
    expect(JSON.stringify(list)).not.toMatch(/[A-HJ-NP-Z2-9]{8}/u);
    expect(list.items.find(item => item.kind === 'chat-roles.imported')!.detail).toContain('提升为全局 owner');
    expect(list.items.find(item => item.kind === 'chat-roles.import-pending')!.detail).toContain('ai.trigger.masters');
  });

  it('is hidden from callers without global iam.manage (who was named is not public)', async () => {
    for (const grants of [adapterIam, [{ permissions: ['status.view'], scope: { kind: 'global' } }] as never]) {
      const list = await collectAttention({ chatRoles: async () => state() }, { allows: allowsFor(grants) });
      expect(list.items).toEqual([]);
    }
  });

  it('says nothing once there is a global owner and the import was read', async () => {
    const list = await collectAttention({ chatRoles: async () => state({ hasGlobalOwner: true, imported: undefined }) }, { allows: allowsFor(globalIam) });
    expect(list.items).toEqual([]);
  });
});

function configPort(initial: Record<string, unknown>): ConfigDocumentPort {
  let document = structuredClone(initial);
  return {
    async read() { return { document: structuredClone(document), revision: '1' } as never; },
    async prepare(_current, patches: readonly ConfigPatch[]) {
      return { commit: async () => { document = applyConfigPatches(document as never, patches as never) as never; } } as never;
    },
  };
}

describe('chat-roles.imports.* RPC (ADR 0060 §4.2)', () => {
  async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'zhin-role-imports-'));
    directories.push(root);
    const logger = { info: () => undefined, warn: () => undefined };
    const base = { configVersion: 2, plugins: { qq: '@x/qq' }, qq: { endpoints: [{ id: 'bot' }] } };
    const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore() });
    const kinds = () => 'platform' as const;
    await (await prepareChatRoleMigration({ projectRoot: root, config: configPort({ ...base, ai: { trigger: { masters: ['first'] } } }), expand: value => value, logger }))
      .complete(roles, { persistent: true, adapterKind: kinds });
    await prepareChatRoleMigration({ projectRoot: root, config: configPort({ ...base, ai: { trigger: { masters: ['second'] } } }), expand: value => value, logger });
    const book = new ChatRoleImportBook({ projectRoot: root, roles: () => roles, adapterKind: () => kinds });
    return { roles, book };
  }

  it('refuses callers without global iam.manage, whatever scope the payload names', async () => {
    const { roles, book } = await setup();
    const pending = (await book.read()).pending[0]!;
    for (const authorizeGlobal of [undefined, () => false, () => { throw new Error('x'); }]) {
      const reply = await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.resolve', data: { decision: 'import', id: pending.id, level: 'adapter', key: 'qq' } },
        { imports: book, roles, ...(authorizeGlobal ? { authorizeGlobal } : {}), actor: 'user:2' });
      expect(reply?.status).toBe(403);
    }
    expect(roles.hasRole({ adapter: 'qq', userId: 'second' }, '', 'owner')).toBe(false);
  });

  it('lists, imports, rejects repeats and unknown decisions', async () => {
    const { roles, book } = await setup();
    const context = { imports: book, roles, authorizeGlobal: () => true, actor: 'user:1' };
    const listed = await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.list' }, context);
    const data = listed?.body.data as Record<string, any>;
    expect(data.hasGlobalOwner).toBe(true);
    expect(data.imported.map((entry: { userId: string }) => entry.userId)).toEqual(['first']);
    const id = data.pending[0].id as string;
    const imported = await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.resolve', data: { decision: 'import', id } }, context);
    expect(imported?.body.data).toEqual({ status: 'imported', result: 'written' });
    expect(roles.store.get('global', '', { adapter: 'qq', userId: 'second' })?.grantedBy).toBe('user:1');
    expect((await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.resolve', data: { decision: 'import', id } }, context))?.status).toBe(404);
    expect((await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.resolve', data: { decision: 'grant', id } }, context))?.status).toBe(400);
    expect((await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.resolve', data: { decision: 'import', id: '../x' } }, context))?.status).toBe(400);
    expect((await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.imports.resolve', data: { decision: 'acknowledge' } }, context))?.body.data).toEqual({ status: 'acknowledged' });
    expect(await dispatchChatRoleImportsConsoleRpc({ type: 'chat-roles.list' }, context)).toBeNull();
  });
});
