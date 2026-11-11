import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { ConsoleIamService, IamError } from '../../../../../../host/gateway/src/iam/service.js';
import { LoginRateLimiter } from '../../../../../../host/gateway/src/iam/rate-limit.js';
import { defineConsoleIamTables } from '../../../../../../host/gateway/src/iam/tables.js';
import { verifyPassword, hashPassword } from '../../../../../../host/gateway/src/iam/crypto.js';

const PASSWORD = 'correct-horse-battery';
const roots: string[] = [];
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function openIam(options: Partial<ConstructorParameters<typeof ConsoleIamService>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-iam-'));
  roots.push(root);
  const database = createDatabaseHost({ dialect: 'sqlite', filename: join(root, '.zhin', 'data.sqlite') } as never);
  expect(defineConsoleIamTables(database.gatewayTableHost())).toBe(true);
  await database.start();
  let now = 1_700_000_000_000;
  const clock = { now: () => now, advance: (ms: number) => { now += ms; } };
  const service = new ConsoleIamService({ database: database.gatewayTableHost(), projectRoot: root, now: clock.now, ...options });
  await service.start({ timers: false });
  closers.push(async () => { service.stop(); await database.stop(); });
  return { service, database, root, clock };
}

async function expectIamError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error: unknown) => error instanceof IamError && error.code === code);
}

describe('password hashing', () => {
  it('uses scrypt with a random salt and rejects wrong or malformed hashes', async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);
    expect(first).toMatch(/^scrypt\$32768\$8\$1\$/u);
    expect(first).not.toBe(second);
    expect(await verifyPassword(PASSWORD, first)).toBe(true);
    expect(await verifyPassword('wrong-password!', first)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'plain')).toBe(false);
  });
});

describe('ConsoleIamService', () => {
  it('starts uninitialised, seeds built-in roles and becomes initialised with the first owner', async () => {
    const { service, root } = await openIam();
    expect(service.initialized()).toBe(false);
    expect((await service.listRoles()).map(role => role.name)).toEqual(['admin', 'operator', 'owner', 'viewer']);
    expect((await service.listRoles()).every(role => role.builtin)).toBe(true);
    const owner = await service.createOwner({ username: 'Alice', password: PASSWORD });
    expect(owner).toMatchObject({ username: 'alice', bindings: [{ role: 'owner', scope: { kind: 'global' } }] });
    expect(service.initialized()).toBe(true);
    expect(existsSync(join(root, '.zhin', 'console-iam.initialized'))).toBe(true);
    await expectIamError(service.createOwner({ username: 'bob', password: PASSWORD }), 'conflict');
    // Built-in roles are immutable.
    await expectIamError(service.updateRole('builtin:viewer', { permissions: ['iam.manage'] }), 'forbidden');
    await expectIamError(service.deleteRole('builtin:owner'), 'forbidden');
  });

  it('validates usernames, passwords and unknown permissions', async () => {
    const { service } = await openIam();
    await expectIamError(service.createUser({ username: 'x', password: PASSWORD }), 'invalid_input');
    await expectIamError(service.createUser({ username: 'carol', password: 'short' }), 'invalid_input');
    await expectIamError(service.createRole({ name: 'ops', permissions: ['root.everything'] }), 'invalid_input');
    await service.createUser({ username: 'carol', password: PASSWORD });
    await expectIamError(service.createUser({ username: 'CAROL', password: PASSWORD }), 'conflict');
  });

  it('logs in with sessions, slides expiry, and revokes sessions on logout and password change', async () => {
    const { service, clock } = await openIam();
    await service.createOwner({ username: 'alice', password: PASSWORD });
    const login = await service.login('alice', PASSWORD, { ip: '10.0.0.1' });
    expect(login.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const principal = await service.authenticate(login.token);
    expect(principal).toMatchObject({ kind: 'user', username: 'alice', roles: ['owner'] });
    clock.advance(11 * 60 * 60_000);
    expect(await service.authenticate(login.token)).not.toBeNull(); // slides the 12h window
    clock.advance(11 * 60 * 60_000);
    expect(await service.authenticate(login.token)).not.toBeNull();
    clock.advance(13 * 60 * 60_000);
    expect(await service.authenticate(login.token)).toBeNull();

    const second = await service.login('alice', PASSWORD);
    const other = await service.login('alice', PASSWORD);
    const current = (await service.authenticate(second.token))!;
    await expectIamError(service.changePassword(current, 'wrong-password!', 'new-password-123'), 'unauthorized');
    const changed = await service.changePassword(current, PASSWORD, 'new-password-123');
    expect(await service.authenticate(second.token)).toBeNull();
    expect(await service.authenticate(other.token)).toBeNull();
    expect(changed.token && await service.authenticate(changed.token)).toBeTruthy();
    await expectIamError(service.login('alice', PASSWORD), 'unauthorized');
    const fresh = await service.login('alice', 'new-password-123');
    await service.logout((await service.authenticate(fresh.token))!);
    expect(await service.authenticate(fresh.token)).toBeNull();
  });

  it('caps sessions at 30 days regardless of activity', async () => {
    const { service, clock } = await openIam();
    await service.createOwner({ username: 'alice', password: PASSWORD });
    const { token } = await service.login('alice', PASSWORD);
    for (let day = 0; day < 31; day++) {
      clock.advance(10 * 60 * 60_000);
      await service.authenticate(token);
      clock.advance(10 * 60 * 60_000);
      await service.authenticate(token);
      clock.advance(4 * 60 * 60_000);
    }
    expect(await service.authenticate(token)).toBeNull();
  });

  it('rate-limits failed logins per username and IP with an exponential lockout', async () => {
    let now = 0;
    const { service, clock } = await openIam({ rateLimiter: new LoginRateLimiter({ now: () => now }) });
    await service.createOwner({ username: 'alice', password: PASSWORD });
    for (let attempt = 0; attempt < 5; attempt++) await expectIamError(service.login('alice', 'wrong-password!', { ip: '1.1.1.1' }), 'unauthorized');
    // Locked even with the right password, and from another IP for this username.
    await expectIamError(service.login('alice', PASSWORD, { ip: '2.2.2.2' }), 'rate_limited');
    now += 15 * 60_000 + 1;
    for (let attempt = 0; attempt < 5; attempt++) await expectIamError(service.login('alice', 'wrong-password!', { ip: '3.3.3.3' }), 'unauthorized');
    now += 15 * 60_000 + 1;
    await expectIamError(service.login('alice', PASSWORD, { ip: '4.4.4.4' }), 'rate_limited'); // second lockout is 30 min
    now += 15 * 60_000;
    expect((await service.login('alice', PASSWORD, { ip: '4.4.4.4' })).token).toBeTruthy();
    // Unknown users fail the same way.
    await expectIamError(service.login('nobody', PASSWORD, { ip: '5.5.5.5' }), 'unauthorized');
    void clock;
    const audit = await service.listAudit({ action: 'auth.login' });
    expect(audit.entries.some(entry => entry.outcome === 'denied')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it('keeps at least one enabled global owner', async () => {
    const { service } = await openIam();
    const alice = await service.createOwner({ username: 'alice', password: PASSWORD });
    await expectIamError(service.setDisabled(alice.id, true), 'last_owner');
    await expectIamError(service.deleteUser(alice.id), 'last_owner');
    await expectIamError(service.setBindings(alice.id, [{ role: 'admin' }]), 'last_owner');
    await expectIamError(service.setBindings(alice.id, [{ role: 'owner', scopeKind: 'adapter', scopeKey: 'qq' }]), 'last_owner');
    const bob = await service.createUser({ username: 'bob', password: PASSWORD, bindings: [{ role: 'owner' }] });
    await service.setDisabled(alice.id, true);
    expect(service.initialized()).toBe(true);
    await expectIamError(service.deleteUser(bob.id), 'last_owner');
    await service.setDisabled(alice.id, false);
    await service.setBindings(bob.id, [{ role: 'viewer' }]);
    await service.deleteUser(bob.id);
    expect((await service.listUsers()).map(user => user.username)).toEqual(['alice']);
  });

  it('applies scoped bindings and narrows API tokens to the issuing user', async () => {
    const { service, clock } = await openIam();
    await service.createOwner({ username: 'alice', password: PASSWORD });
    const op = await service.createUser({ username: 'op', password: PASSWORD, bindings: [
      { role: 'operator', scopeKind: 'adapter', scopeKey: 'qq' },
      { role: 'viewer', scopeKind: 'global' },
    ] });
    await expectIamError(service.setBindings(op.id, [{ role: 'operator', scopeKind: 'endpoint', scopeKey: 'qq' }]), 'invalid_input');
    const { token, record } = await service.createToken(op.id, { name: 'ci', permissions: ['endpoint.view', 'endpoint.operate'] });
    expect(record).toMatchObject({ name: 'ci', permissions: ['endpoint.operate', 'endpoint.view'] });
    const principal = (await service.authenticate(token))!;
    expect(principal.kind).toBe('api-token');
    expect(principal.grants.flatMap(grant => grant.permissions)).toEqual(expect.arrayContaining(['endpoint.view', 'endpoint.operate']));
    expect(principal.grants.flatMap(grant => grant.permissions)).not.toContain('status.view');
    // Demoting the user narrows existing tokens immediately.
    await service.setBindings(op.id, [{ role: 'viewer' }]);
    expect((await service.authenticate(token))!.grants.flatMap(grant => grant.permissions)).toEqual(['endpoint.view']);
    const expiring = await service.createToken(op.id, { name: 'short', expiresAt: clock.now() + 1000 });
    clock.advance(1001);
    expect(await service.authenticate(expiring.token)).toBeNull();
    // Disabling the user revokes every API token.
    await service.setDisabled(op.id, true);
    expect(await service.authenticate(token)).toBeNull();
    await service.setDisabled(op.id, false);
    expect(await service.authenticate(token)).toBeNull();
    expect(await service.listTokens(op.id)).toEqual([]);
  });

  it('pages the audit log and removes entries older than 180 days', async () => {
    const { service, clock } = await openIam();
    for (let index = 0; index < 5; index++) {
      service.audit({ actor: 'user:x', action: `rpc:test-${index}`, outcome: 'ok', detail: { keys: ['a'] } });
      clock.advance(1000);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    const page = await service.listAudit({ limit: 2 });
    expect(page.entries.map(entry => entry.action)).toEqual(['rpc:test-4', 'rpc:test-3']);
    const next = await service.listAudit({ limit: 2, before: page.next! });
    expect(next.entries.map(entry => entry.action)).toEqual(['rpc:test-2', 'rpc:test-1']);
    clock.advance(181 * 24 * 60 * 60_000);
    service.audit({ actor: 'user:x', action: 'rpc:recent', outcome: 'ok' });
    await new Promise(resolve => setTimeout(resolve, 50));
    await service.cleanup();
    expect((await service.listAudit()).entries.map(entry => entry.action)).toEqual(['rpc:recent']);
  });

  it('notifies credential revocations: password, bindings, disable, delete', async () => {
    const { service } = await openIam();
    await service.createOwner({ username: 'alice', password: PASSWORD });
    const bob = await service.createUser({ username: 'bob', password: PASSWORD, bindings: [{ role: 'viewer' }] });
    const events: unknown[] = [];
    const stop = service.onCredentialsRevoked(event => events.push(event));
    await service.resetPassword(bob.id, 'another-long-password');
    await service.setBindings(bob.id, [{ role: 'operator' }]);
    await service.setDisabled(bob.id, true);
    await service.deleteUser(bob.id);
    expect(events).toEqual([
      { userId: bob.id, reason: 'password' },
      { userId: bob.id, reason: 'bindings' },
      { userId: bob.id, reason: 'disabled' },
      { userId: bob.id, reason: 'deleted' },
    ]);
    stop();
    await service.createUser({ username: 'carol', password: PASSWORD });
    expect(events).toHaveLength(4);
  });
});
