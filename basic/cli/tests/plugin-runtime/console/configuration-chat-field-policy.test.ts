import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConfigDocument } from '@zhin.js/runtime';
import { HOST_CONFIG_PATCH_PATHS } from '@zhin.js/console-protocol';
import { ConsoleConfigurationStore } from '../../../src/plugin-runtime/console/configuration.js';
import {
  assertChatConfigurationScope, assertChatOptionalLeaf, chatLeafTypes, chatConfigurationLeaves, ConfigChatAccessError, isChatPermissionSegment,
} from '../../../src/plugin-runtime/console/configuration-chat-policy.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const roles = { type: 'array', items: { type: 'string' } };
const schema = { type: 'object', additionalProperties: false, required: ['name'], properties: {
  name: { type: 'string' }, nickname: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
  profile: { type: 'object', additionalProperties: false, properties: { bio: { type: 'string' } } },
  rows: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } },
  master: { type: 'string' }, trusted: roles, Admins: roles,
  endpoints: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, master: { type: 'string' }, trusted: roles } } },
  adminIds: roles,
  inbound: { type: 'object', properties: { enabled: { type: 'boolean' }, bypassMasters: { type: 'boolean' },
    whitelist: { type: 'object', properties: { userIds: roles, conversationIds: roles } } } },
  toolHardGate: { type: 'object', properties: { enabled: { type: 'boolean' } } },
} };
const initial = { name: 'bot', nickname: 'Before', tags: ['a'], profile: { bio: 'hi' }, rows: [{ label: 'x' }],
  master: 'owner-id-private', trusted: ['trusted-id-private'], Admins: ['admin-id-private'],
  endpoints: [{ id: 'e1', name: 'e1-name', master: 'endpoint-owner-private', trusted: ['endpoint-trusted-private'] }], toolHardGate: { enabled: true },
  adminIds: ['admin-ids-private'], inbound: { enabled: true, bypassMasters: true, whitelist: { userIds: ['whitelist-private'], conversationIds: ['conv-private'] } } };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'zhin-chat-policy-')); roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'policy-root', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  await mkdir(join(root, 'demo'));
  await writeFile(join(root, 'demo/package.json'), JSON.stringify({ name: '@fixture/demo', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  await writeFile(join(root, 'demo/schema.json'), JSON.stringify(schema));
  const file = join(root, 'zhin.config.json');
  await writeFile(file, JSON.stringify({ configVersion: 2, plugins: { demo: './demo' }, demo: initial,
    ai: { trigger: { masters: ['global-private'], trusted: ['global-trusted-private'], ambient: { mode: 'active' } } } }));
  const document = createConfigDocument(file);
  const store = new ConsoleConfigurationStore({ projectRoot: root, document, environmentForPlugin: () => ({ has: () => true }) });
  return { file, store, document };
}

describe('chat field policy units', () => {
  it('finds exact declared fields beyond the display limit without opening dynamic or array paths', () => {
    const wide = { type: 'object', properties: Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`field${String(i).padStart(3, '0')}`, { type: 'string' }])) };
    expect(chatConfigurationLeaves(wide, [])).toHaveLength(256);
    expect(chatConfigurationLeaves(wide, ['field256'])).toEqual([['field256']]);
    expect(chatConfigurationLeaves(schema, ['tags', '0'])).toEqual([]);
    expect(chatConfigurationLeaves(schema, ['rows', '0', 'label'])).toEqual([]);
    const dynamic = { type: 'object', properties: { fixed: { type: 'string' } },
      patternProperties: { '^pattern': { type: 'string' } }, additionalProperties: { type: 'string' } };
    expect(chatConfigurationLeaves(dynamic, ['patternName'])).toEqual([]);
    expect(chatConfigurationLeaves(dynamic, ['dynamicName'])).toEqual([]);
    expect(chatConfigurationLeaves(dynamic, ['fixed'])).toEqual([['fixed']]);
  });
  it('retains the discovery depth boundary and resolves declared ancestors through local references', () => {
    const within = Array.from({ length: 12 }, (_, i) => `level${i}`);
    const nested = (path: readonly string[]) => {
      let result: Record<string, unknown> = { type: 'string' };
      for (const key of [...path].reverse()) result = { type: 'object', properties: { [key]: result } };
      return result;
    };
    expect(chatConfigurationLeaves(nested(within), within)).toEqual([within]);
    const beyond = [...within, 'last'];
    expect(chatConfigurationLeaves(nested(beyond), beyond)).toEqual([]);
    const referenced = { type: 'object', $defs: { profile: { type: 'object', properties: { label: { type: 'string' } } } },
      properties: { profile: { $ref: '#/$defs/profile' } } };
    expect(chatConfigurationLeaves(referenced, ['profile', 'label'])).toEqual([['profile', 'label']]);
  });
  it.each(['master', 'masters', 'trusted', 'toolHardGate', 'tool_hard_gate', 'Admins', 'approvers', 'permissions', 'owner',
    'adminIds', 'ownerId', 'masterId', 'trustedUsers', 'superUsers', 'super_users', 'whitelist', 'allowlist', 'allowList', 'blacklist',
    'denylist', 'blockedUsers', 'bypassMasters', 'sudoers', 'operators', 'moderators', 'roles', 'userRoles', 'acl', 'allowedUserIds',
    'masterVolume', 'trustedProxy'])('treats %s as a permission field (contains/prefix/suffix, fail-closed)', key => {
    expect(isChatPermissionSegment(key)).toBe(true);
  });
  it.each(['nickname', 'mode', 'maxTokens', 'enabled', 'commandPrefix', 'userIds', 'conversationIds', 'contentModeration', 'inbound', 'timeout'])('does not treat ordinary key %s as a permission field', key => {
    expect(isChatPermissionSegment(key)).toBe(false);
  });
  it('keeps the Host chat whitelist identical to HOST_CONFIG_PATCH_PATHS', () => {
    const scope = { hostKeys: ['ai', 'locale', 'http'], hostPaths: HOST_CONFIG_PATCH_PATHS, declarationKeys: new Set(['plugins']) };
    expect(() => assertChatConfigurationScope(['ai', 'trigger', 'ambient', 'mode'], scope)).not.toThrow();
    for (const path of [['ai', 'trigger', 'enabled'], ['ai', 'trigger'], ['locale'], ['http', 'port']]) {
      expect(() => assertChatConfigurationScope(path, scope)).toThrow(expect.objectContaining({ kind: 'scope' }));
    }
    expect(() => assertChatConfigurationScope(['ai', 'trigger', 'masters'], scope)).toThrow(expect.objectContaining({ kind: 'permission' }));
    expect(() => assertChatConfigurationScope(['plugins', 'demo'], scope)).toThrow(expect.objectContaining({ kind: 'scope' }));
  });
  it('accepts scalar and scalar-array leaves and rejects objects or object arrays', () => {
    expect(chatLeafTypes(schema, ['nickname'])).toEqual(['string']);
    expect(chatLeafTypes(schema, ['tags'])).toEqual(['array']);
    for (const path of [[], ['profile'], ['rows'], ['endpoints']]) expect(() => chatLeafTypes(schema, path)).toThrow(expect.objectContaining({ kind: 'leaf' }));
    expect(() => assertChatOptionalLeaf(schema, ['name'])).toThrow(expect.objectContaining({ kind: 'required' }));
    expect(() => assertChatOptionalLeaf(schema, ['nickname'])).not.toThrow();
  });
});

describe('chat field policy through the store', () => {
  it.each([
    ['demo', 'master'], ['demo', 'trusted'], ['demo', 'Admins'], ['demo', 'endpoints', '0', 'master'], ['demo', 'endpoints', '0', 'trusted'],
    ['demo', 'toolHardGate', 'enabled'], ['ai', 'trigger', 'masters'], ['ai', 'trigger', 'trusted'],
    ['demo', 'inbound', 'whitelist', 'userIds'], ['demo', 'inbound', 'bypassMasters'], ['demo', 'adminIds'],
    ['demo', 'endpoints', '0', 'id'], ['demo', 'endpoints', '0', 'name'],
  ])('rejects permission field %j for get, set and unset without disclosing values (C4)', async (...path) => {
    const f = await fixture(); const before = await readFile(f.file, 'utf8'); const { revision } = await f.store.readSource();
    const prepare = vi.spyOn(f.document, 'prepare');
    for (const run of [
      () => f.store.readChat(path, 'get'),
      () => f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path, value: 'mallory' }] }),
      () => f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'remove', path }] }),
    ]) {
      const error = await run().then(() => undefined, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConfigChatAccessError);
      expect(error).toMatchObject({ kind: 'permission' });
      expect(JSON.stringify(error) + String(error)).not.toMatch(/private/);
    }
    expect(prepare).not.toHaveBeenCalled(); expect(await readFile(f.file, 'utf8')).toBe(before);
  });
  it('omits permission, object and Host non-whitelisted fields from `fields`', async () => {
    const f = await fixture();
    const result = await f.store.readChat([], 'fields');
    const paths = result.fields!.map(field => field.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['demo.name', 'demo.nickname', 'demo.tags', 'demo.profile.bio', 'ai.trigger.ambient.mode']));
    expect(paths).toContain('demo.inbound.enabled');
    expect(paths.some(path => /master|trusted|Admins|adminIds|whitelist|bypass|toolHardGate|endpoints|rows/iu.test(path))).toBe(false);
    expect(paths.some(path => path.startsWith('ai.') && !path.startsWith('ai.trigger.ambient.'))).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/private|Before/);
    for (const path of [['demo', 'master'], ['demo', 'inbound', 'whitelist'], ['demo', 'inbound', 'whitelist', 'userIds'], ['demo', 'inbound', 'bypassMasters'],
      ['demo', 'endpoints', '0', 'id']]) await expect(f.store.readChat(path, 'fields')).rejects.toMatchObject({ kind: 'permission' });
    await expect(f.store.readChat(['locale'], 'fields')).rejects.toMatchObject({ kind: 'scope' });
    expect((await f.store.readChat(['ai'], 'fields')).fields!.every(field => field.path.slice(0, 3).join('.') === 'ai.trigger.ambient')).toBe(true);
  });
  it('writes exactly one leaf and refuses object writes, multi-patch requests and required removal (leaf-only)', async () => {
    const f = await fixture(); const before = await readFile(f.file, 'utf8'); const { revision } = await f.store.readSource();
    const prepare = vi.spyOn(f.document, 'prepare');
    await expect(f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: ['demo', 'profile'], value: { bio: 'new' } }] }))
      .rejects.toMatchObject({ kind: 'leaf' });
    await expect(f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'remove', path: ['demo', 'profile'] }] }))
      .rejects.toMatchObject({ kind: 'leaf' });
    await expect(f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: ['demo', 'rows', '0'], value: { label: 'y' } }] }))
      .rejects.toMatchObject({ kind: 'leaf' });
    await expect(f.store.patchChat({ expectedRevision: revision, patches: [
      { op: 'set', path: ['demo', 'nickname'], value: 'a' }, { op: 'set', path: ['demo', 'profile', 'bio'], value: 'b' },
    ] })).rejects.toMatchObject({ kind: 'leaf' });
    await expect(f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'remove', path: ['demo', 'name'] }] }))
      .rejects.toMatchObject({ kind: 'required' });
    await expect(f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'remove', path: ['demo', 'absent'] }] }))
      .rejects.toBeInstanceOf(ConfigChatAccessError);
    expect(prepare).not.toHaveBeenCalled(); expect(await readFile(f.file, 'utf8')).toBe(before);
    expect(await f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: ['demo', 'profile', 'bio'], value: 'new' }] }))
      .toMatchObject({ status: 'saved' });
    const next = (await f.store.readSource()).revision;
    expect(await f.store.patchChat({ expectedRevision: next, patches: [{ op: 'remove', path: ['demo', 'nickname'] }] })).toMatchObject({ status: 'saved' });
    const saved = JSON.parse(await readFile(f.file, 'utf8'));
    expect(saved.demo.profile).toEqual({ bio: 'new' }); expect(saved.demo).not.toHaveProperty('nickname');
    expect(saved.demo.master).toBe('owner-id-private');
  });
  it('refuses planting new ${…} / env:// references on set, even with non-credential names (M1)', async () => {
    const f = await fixture(); const before = await readFile(f.file, 'utf8'); const { revision } = await f.store.readSource();
    const prepare = vi.spyOn(f.document, 'prepare');
    for (const [path, value] of [
      [['demo', 'nickname'], '${HOME}'], [['demo', 'nickname'], 'x ${DB_URL} y'], [['demo', 'nickname'], 'env://GITHUB_PAT'],
      [['demo', 'nickname'], 'ENV://PATH'], [['demo', 'tags'], ['ok', '${OPENAI_KEY}']], [['ai', 'trigger', 'ambient', 'mode'], '${MODE}'],
    ] as const) {
      await expect(f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path, value }] }))
        .rejects.toMatchObject({ kind: 'sensitive' });
    }
    expect(prepare).not.toHaveBeenCalled(); expect(await readFile(f.file, 'utf8')).toBe(before);
    expect(await f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: ['demo', 'nickname'], value: 'plain $HOME text' }] }))
      .toMatchObject({ status: 'saved' });
  });
});
