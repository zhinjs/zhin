import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isProjectPathAllowed } from '@zhin.js/host-http';
import { ChatRoleService, ChatRoleStore, type InstanceChatRoleService } from '../../src/instance/chat-roles.js';
import {
  CHAT_OWNER_CLAIM_FILE, CHAT_OWNER_CLAIM_MAX_FAILURES, CHAT_OWNER_CLAIM_MAX_SENDER_FAILURES, CHAT_OWNER_CLAIM_SENDER_WINDOW_MS, ChatOwnerClaim, chatOwnerClaimCodeHash, executeOwnerClaim, generateChatOwnerClaimCode, hasGlobalOwner,
} from '../../src/instance/chat-owner-claim.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

function setup(options: { persistent?: boolean; now?: () => number } = {}) {
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
      audit: () => entry => { audits.push(entry); }, code: () => codes[next++]!, now: options.now ?? (() => 42), pid: 4242 }),
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
    // Security review: the log (SystemLog, `GET /logs`) never carries the code, only its hash prefix.
    expect(lines.join('\n')).not.toContain('AAAA2222');
    expect(lines.some(line => line.includes('zhin status') && line.includes(chatOwnerClaimCodeHash('AAAA2222')))).toBe(true);
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
    expect(lines.some(line => line.includes(chatOwnerClaimCodeHash('BBBB3333')))).toBe(true);
    expect(lines.join('\n')).not.toMatch(/AAAA2222|BBBB3333/u);
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
    // Different senders (one sender is limited, see below).
    for (let attempt = 0; attempt < CHAT_OWNER_CLAIM_MAX_FAILURES; attempt += 1) {
      expect(await claim.attempt({ code: `ZZZZ${attempt}999`, identity: { adapter: 'qq', userId: `x${attempt}` }, kind: 'private', adapterKind: 'platform' })).toBe('invalid');
    }
    expect(await claim.attempt({ code: 'AAAA2222', identity: { adapter: 'qq', userId: 'y' }, kind: 'private', adapterKind: 'platform' })).toBe('invalid');
    expect(await claim.attempt({ code: 'BBBB3333', identity: { adapter: 'qq', userId: 'z' }, kind: 'private', adapterKind: 'platform' })).toBe('claimed');
    expect(hasGlobalOwner(roles)).toBe(true);
  });

  it('limits wrong attempts per sender so one sender cannot keep rotating the code (security review)', async () => {
    let now = 1_000;
    const { make, roles } = setup({ now: () => now });
    const claim = make();
    await claim.refresh();
    const mallory = { adapter: 'qq', userId: 'mallory' };
    for (let attempt = 0; attempt < CHAT_OWNER_CLAIM_MAX_SENDER_FAILURES; attempt += 1) {
      expect(await claim.attempt({ code: `ZZZZ${attempt}999`, identity: mallory, kind: 'private', adapterKind: 'platform' })).toBe('invalid');
    }
    // Further attempts are refused without counting: the code never rotates because of one sender.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(await claim.attempt({ code: `YYYY${attempt % 10}888`, identity: mallory, kind: 'private', adapterKind: 'platform' })).toBe('locked');
    }
    expect(await executeOwnerClaim({ code: 'AAAA2222', actor: actor('private', 'mallory') as never, adapterKind: 'platform', locale: 'zh-CN' }, claim)).toContain('错误次数过多');
    expect(roles.hasRole(mallory, '', 'owner')).toBe(false);
    // The original code still works for the real deployer.
    expect(await claim.attempt({ code: 'AAAA2222', identity: { adapter: 'qq', userId: 'alice' }, kind: 'private', adapterKind: 'platform' })).toBe('claimed');
    // The limit is per window.
    const other = setup({ now: () => now });
    const reopened = other.make();
    await reopened.refresh();
    for (let attempt = 0; attempt < CHAT_OWNER_CLAIM_MAX_SENDER_FAILURES; attempt += 1) {
      await reopened.attempt({ code: `ZZZZ${attempt}999`, identity: mallory, kind: 'private', adapterKind: 'platform' });
    }
    expect(await reopened.attempt({ code: 'ZZZZ7999', identity: mallory, kind: 'private', adapterKind: 'platform' })).toBe('locked');
    now += CHAT_OWNER_CLAIM_SENDER_WINDOW_MS;
    expect(await reopened.attempt({ code: 'ZZZZ7999', identity: mallory, kind: 'private', adapterKind: 'platform' })).toBe('invalid');
  });

  it('one attempt compares one candidate: text carrying the code among other symbols revokes it (#1289 review)', async () => {
    const { make, roles } = setup();
    const claim = make();
    await claim.refresh();
    const identity = { adapter: 'qq', userId: 'mallory' };
    expect(await claim.attempt({ code: `${'Z'.repeat(400)}AAAA2222ZZZZ`, identity, kind: 'private', adapterKind: 'platform' })).toBe('revoked');
    expect(hasGlobalOwner(roles)).toBe(false);
    expect(await claim.attempt({ code: 'AAAA2222', identity, kind: 'private', adapterKind: 'platform' })).toBe('invalid');
    expect(await claim.attempt({ code: '认领:ｂｂｂｂ ３３３３!', identity: { adapter: 'qq', userId: 'alice' }, kind: 'private', adapterKind: 'platform' })).toBe('claimed');
  });

  it('the claim file is not reachable through the Console project-file routes (security review)', () => {
    expect(isProjectPathAllowed(CHAT_OWNER_CLAIM_FILE)).toBe(false);
    expect(isProjectPathAllowed(CHAT_OWNER_CLAIM_FILE.replace(/\\/gu, '/'))).toBe(false);
  });

  it('does not open without a relational database', async () => {
    const { make } = setup({ persistent: false });
    const claim = make();
    await claim.refresh();
    expect(claim.active).toBe(false);
  });
});
