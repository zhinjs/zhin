import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatRoleService, ChatRoleStore, type InstanceChatRoleService } from '../../src/instance/chat-roles.js';
import {
  CHAT_OWNER_CLAIM_FILE, CHAT_OWNER_CLAIM_MAX_FAILURES, ChatOwnerClaim, chatOwnerClaimCodeHash, executeOwnerClaim, generateChatOwnerClaimCode, hasGlobalOwner,
} from '../../src/instance/chat-owner-claim.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

function setup(options: { persistent?: boolean } = {}) {
  const roles: InstanceChatRoleService = new ChatRoleService({ store: options.persistent === false
    ? new ChatRoleStore({ database: { dialect: 'memory', started: true, models: new Map() } as never })
    : new ChatRoleStore() });
  const lines: string[] = [];
  const audits: Record<string, any>[] = [];
  let next = 0;
  const codes = ['AAAA2222', 'BBBB3333', 'CCCC4444', 'DDDD5555', 'EEEE6666'];
  return {
    roles, lines, audits,
    make: (projectRoot?: string) => new ChatOwnerClaim({ roles, ...(projectRoot ? { projectRoot } : {}),
      logger: { info: line => { lines.push(line); }, warn: line => { lines.push(line); } },
      audit: () => entry => { audits.push(entry); }, code: () => codes[next++]!, now: () => 42, pid: 4242 }),
  };
}

const actor = (kind: 'private' | 'group' = 'private', userId = 'alice') => ({
  identity: { adapter: 'qq', userId }, conversationKey: `qq/bot/${kind}:1`, endpointKey: 'qq/bot', kind, context: { conversationKey: `qq/bot/${kind}:1` },
});

describe('chat owner claim code (ADR 0060 §3.3)', () => {
  it('generates 8-symbol codes without ambiguous characters', () => {
    for (let index = 0; index < 50; index += 1) expect(generateChatOwnerClaimCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/u);
  });

  it('opens only without a global owner, writes the local file, and one claim makes a global owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-claim-'));
    directories.push(root);
    const { roles, lines, audits, make } = setup();
    const claim = make(root);
    await claim.refresh();
    expect(claim.active).toBe(true);
    expect(lines.some(line => line.includes('认领 AAAA2222'))).toBe(true);
    const file = join(root, CHAT_OWNER_CLAIM_FILE);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ code: 'AAAA2222', pid: 4242, createdAt: 42 });
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o077).toBe(0);
    const reply = await executeOwnerClaim({ code: 'aaaa-2222', actor: actor() as never, adapterKind: 'platform', locale: 'zh-CN' }, claim);
    expect(reply).toContain('认领成功');
    expect(roles.store.get('global', '', { adapter: 'qq', userId: 'alice' })).toMatchObject({ role: 'owner', grantedBy: 'claim:qq:alice' });
    expect(hasGlobalOwner(roles)).toBe(true);
    expect(claim.active).toBe(false);
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    // The audit carries only the code's hash prefix, never the code.
    expect(audits.at(-1)).toMatchObject({ action: 'chat-roles.claim', outcome: 'ok', actor: 'chat:qq:alice', detail: { codeHash: chatOwnerClaimCodeHash('AAAA2222') } });
    expect(JSON.stringify(audits)).not.toContain('AAAA2222');
    // One-time: a second person with the same code gets nothing.
    expect(await executeOwnerClaim({ code: 'AAAA2222', actor: actor('private', 'mallory') as never, adapterKind: 'platform', locale: 'zh-CN' }, claim)).toContain('不接受认领');
    expect(roles.hasRole({ adapter: 'qq', userId: 'mallory' }, '', 'owner')).toBe(false);
  });

  it('stays closed when a global owner exists, and closes when one is granted elsewhere', async () => {
    const { roles, make } = setup();
    await roles.store.grant({ level: 'global', key: '', adapter: 'tg', userId: 'boss', role: 'owner' });
    const claim = make();
    await claim.refresh();
    expect(claim.active).toBe(false);
    const other = setup();
    const open = other.make();
    await open.refresh();
    expect(open.active).toBe(true);
    await other.roles.store.grant({ level: 'global', key: '', adapter: 'qq', userId: 'boss', role: 'owner' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(open.active).toBe(false);
    // An account-level owner is not a global owner: the claim stays open.
    const third = setup();
    await third.roles.store.grant({ level: 'endpoint', key: 'qq/bot', adapter: 'qq', userId: 'm', role: 'owner' });
    const claim3 = third.make();
    await claim3.refresh();
    expect(claim3.active).toBe(true);
  });

  it('refuses group chats and burns a correct code sent there', async () => {
    const { roles, make, lines } = setup();
    const claim = make();
    await claim.refresh();
    const reply = await executeOwnerClaim({ code: 'AAAA2222', actor: actor('group') as never, adapterKind: 'platform', locale: 'zh-CN' }, claim);
    expect(reply).toContain('只接受私聊');
    expect(hasGlobalOwner(roles)).toBe(false);
    expect(lines.some(line => line.includes('认领 BBBB3333'))).toBe(true);
    // The burnt code no longer works in private either.
    expect(await executeOwnerClaim({ code: 'AAAA2222', actor: actor() as never, adapterKind: 'platform', locale: 'zh-CN' }, claim)).toContain('不正确');
  });

  it('refuses simulation and unknown adapters (forged sender ids)', async () => {
    const { roles, make } = setup();
    const claim = make();
    await claim.refresh();
    for (const adapterKind of ['simulated', undefined] as const) {
      expect(await executeOwnerClaim({ code: 'AAAA2222', actor: actor() as never, adapterKind, locale: 'zh-CN' }, claim)).toContain('不接受认领');
    }
    expect(hasGlobalOwner(roles)).toBe(false);
    expect(claim.active).toBe(true);
  });

  it(`rotates after ${CHAT_OWNER_CLAIM_MAX_FAILURES} wrong attempts`, async () => {
    const { make, roles } = setup();
    const claim = make();
    await claim.refresh();
    for (let attempt = 0; attempt < CHAT_OWNER_CLAIM_MAX_FAILURES; attempt += 1) {
      expect(await claim.attempt({ code: `ZZZZ${attempt}999`, identity: { adapter: 'qq', userId: 'x' }, kind: 'private', adapterKind: 'platform' })).toBe('invalid');
    }
    expect(await claim.attempt({ code: 'AAAA2222', identity: { adapter: 'qq', userId: 'x' }, kind: 'private', adapterKind: 'platform' })).toBe('invalid');
    expect(await claim.attempt({ code: 'BBBB3333', identity: { adapter: 'qq', userId: 'x' }, kind: 'private', adapterKind: 'platform' })).toBe('claimed');
    expect(hasGlobalOwner(roles)).toBe(true);
  });

  it('does not open without a relational database', async () => {
    const { make } = setup({ persistent: false });
    const claim = make();
    await claim.refresh();
    expect(claim.active).toBe(false);
  });
});
