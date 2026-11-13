import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConsolePluginPermissionInfo } from '@zhin.js/console-protocol';
import { TokenRegistry, type ConsoleUserPrincipal } from '@zhin.js/host-http';
import { ConsoleIamService, IamError } from '../../../../../../host/gateway/src/iam/service.js';
import { dispatchIamRpc } from '../../../../../../host/gateway/src/iam/rpc.js';
import { openGatewayStore } from '../../../../../../host/gateway/src/database/gateway-store.js';

const PASSWORD = 'correct-horse-battery';
const roots: string[] = [];
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const CATALOG: readonly ConsolePluginPermissionInfo[] = Object.freeze([
  { id: 'onebot11:read', level: 'read', declared: false, owners: ['root/onebot11'] },
  { id: 'onebot11:write', level: 'manage', declared: false, owners: ['root/onebot11'] },
  { id: 'rss:write', level: 'operate', declared: true, description: '编辑订阅', owners: ['root/rss'] },
  { id: 'ops:approve', level: 'manage', declared: false, owners: ['root'] },
]);

async function openIam() {
  const root = await mkdtemp(join(tmpdir(), 'zhin-iam-plugin-'));
  roots.push(root);
  // The accounts live in the gateway store (ADR 0059).
  const database = await openGatewayStore(root);
  const service = new ConsoleIamService({ database, projectRoot: root, pluginPermissions: () => CATALOG });
  await service.start({ timers: false });
  closers.push(async () => { service.stop(); await database.close(); });
  const tokens = new TokenRegistry();
  tokens.usePluginPermissions(() => CATALOG);
  return { service, tokens };
}

async function signIn(service: ConsoleIamService, username: string, bindings: Parameters<ConsoleIamService['createUser']>[0]['bindings']) {
  await service.createUser({ username, password: PASSWORD, bindings });
  const { token } = await service.login(username, PASSWORD);
  return (await service.authenticate(token))!;
}

const held = (tokens: TokenRegistry, principal: ConsoleUserPrincipal) => tokens.accessFor(principal).permissions;

describe('Console IAM plugin permissions (ADR 0049 amendment 2026-11-11)', () => {
  it('grants plugin permissions to built-in roles by level and reports them on role listing', async () => {
    const { service, tokens } = await openIam();
    await service.createOwner({ username: 'alice', password: PASSWORD });
    const viewer = await signIn(service, 'vic', [{ role: 'viewer' }]);
    const operator = await signIn(service, 'otto', [{ role: 'operator' }]);
    const admin = await signIn(service, 'ada', [{ role: 'admin' }]);
    expect(held(tokens, viewer)).toEqual(expect.arrayContaining(['onebot11:read']));
    expect(held(tokens, viewer)).not.toContain('rss:write');
    expect(held(tokens, operator)).toEqual(expect.arrayContaining(['onebot11:read', 'rss:write']));
    expect(held(tokens, operator)).not.toEqual(expect.arrayContaining(['ops:approve']));
    expect(held(tokens, operator)).not.toContain('onebot11:write');
    expect(held(tokens, admin)).toEqual(expect.arrayContaining(['onebot11:read', 'onebot11:write', 'rss:write', 'ops:approve']));
    const { token } = await service.login('alice', PASSWORD);
    expect(tokens.accessFor((await service.authenticate(token))!).unrestricted).toBe(true);

    const roles = new Map((await service.listRoles()).map(role => [role.name, role]));
    expect(roles.get('viewer')!.pluginPermissions!.map(entry => entry.id)).toEqual(['onebot11:read']);
    expect(roles.get('operator')!.pluginPermissions).toEqual([
      { id: 'onebot11:read', level: 'read', source: 'level', known: true },
      { id: 'rss:write', level: 'operate', source: 'level', known: true, description: '编辑订阅' },
    ]);
    expect(roles.get('owner')!.pluginPermissions!.map(entry => entry.id)).toEqual(['onebot11:read', 'onebot11:write', 'ops:approve', 'rss:write']);
    expect(roles.get('admin')!.pluginPermissions).toHaveLength(4);
  });

  it('lets custom roles list plugin permissions by id, warning about ones no plugin uses', async () => {
    const { service, tokens } = await openIam();
    await service.createOwner({ username: 'alice', password: PASSWORD });
    const owner = (await service.authenticate((await service.login('alice', PASSWORD)).token))!;
    const created = await dispatchIamRpc({ type: 'iam.roles.create', data: {
      name: 'approver', permissions: ['status.view', 'ops:approve', 'future-plugin:read'],
    } }, service, owner);
    expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({
      role: { permissions: ['future-plugin:read', 'ops:approve', 'status.view'], pluginPermissions: [
        { id: 'future-plugin:read', level: 'read', source: 'explicit', known: false },
        { id: 'ops:approve', level: 'manage', source: 'explicit', known: true },
      ] },
      warnings: [expect.stringContaining('future-plugin:read')],
    });
    const listed = await dispatchIamRpc({ type: 'iam.roles.list' }, service, owner);
    expect((listed.body.data as { pluginPermissions: unknown }).pluginPermissions).toEqual([
      { permission: 'onebot11:read', plugin: 'onebot11', level: 'read' },
      { permission: 'onebot11:write', plugin: 'onebot11', level: 'manage' },
      { permission: 'rss:write', plugin: 'rss', level: 'operate', description: '编辑订阅' },
      { permission: 'ops:approve', plugin: 'ops', level: 'manage' },
    ]);
    for (const bad of ['ops:', 'Ops:approve', 'ops.approve.everything', 'root.everything']) {
      await expect(service.createRole({ name: `bad-${bad.length}`, permissions: [bad] }))
        .rejects.toSatisfy((error: unknown) => error instanceof IamError && error.code === 'invalid_input');
    }
    const approver = await signIn(service, 'apr', [{ role: 'approver' }]);
    expect(held(tokens, approver)).toEqual(['future-plugin:read', 'ops:approve', 'status.view']);
    expect(held(tokens, approver)).not.toContain('onebot11:read');
    const updated = await dispatchIamRpc({ type: 'iam.roles.update', data: {
      id: (created.body.data as { role: { id: string } }).role.id, permissions: ['onebot11:write'],
    } }, service, owner);
    expect(updated.body.data).toMatchObject({ role: { permissions: ['onebot11:write'] } });
    expect((updated.body.data as Record<string, unknown>).warnings).toBeUndefined();
  });

  it('keeps plugin permissions to global bindings', async () => {
    const { service, tokens } = await openIam();
    await service.createOwner({ username: 'alice', password: PASSWORD });
    await service.createRole({ name: 'qq-ops', permissions: ['endpoint.operate', 'onebot11:write', 'plugin.perms.read'] });
    const scoped = await signIn(service, 'sco', [{ role: 'qq-ops', scopeKind: 'adapter', scopeKey: 'onebot11' }]);
    expect(held(tokens, scoped)).toEqual([]);
    expect(tokens.pluginPermissionLevels()('onebot11:write')).toBe('manage');
  });

  it('narrows API tokens to plugin permissions the user holds, never beyond', async () => {
    const { service, tokens } = await openIam();
    await service.createOwner({ username: 'alice', password: PASSWORD });
    const operator = await signIn(service, 'otto', [{ role: 'operator' }]);
    const issued = await service.createToken(operator.userId, { name: 'ci', permissions: ['onebot11:read', 'ops:approve', 'status.view'] });
    const principal = (await service.authenticate(issued.token))!;
    // ops:approve is manage: the operator does not hold it, so the token cannot either.
    expect(held(tokens, principal)).toEqual(['onebot11:read', 'status.view']);
    // A token narrowed to the level permission keeps every catalog id of that level.
    const levelToken = await service.createToken(operator.userId, { name: 'lvl', permissions: ['plugin.perms.operate'] });
    expect(held(tokens, (await service.authenticate(levelToken.token))!)).toEqual(['plugin.perms.operate', 'rss:write']);
    // An owner token narrowed to one plugin permission is no longer unrestricted.
    const ownerId = (await service.listUsers()).find(user => user.username === 'alice')!.id;
    const ownerToken = await service.createToken(ownerId, { name: 'narrow', permissions: ['onebot11:read'] });
    const access = tokens.accessFor((await service.authenticate(ownerToken.token))!);
    expect(access).toMatchObject({ unrestricted: false, permissions: ['onebot11:read'] });
  });
});
