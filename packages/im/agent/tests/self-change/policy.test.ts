import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FORBIDDEN_CHANGE_CONFIG_KEYS,
  SELF_CHANGE_SECURITY_CONFIG_KEYS,
  SELF_CHANGE_STATUSES,
  SelfChangeConfigKeyError,
  SelfChangePathError,
  SelfChangeValidationError,
  assertConfigPatchAllowed,
  canTransitionSelfChange,
  findForbiddenConfigKey,
  isSelfChangeTerminal,
  normalizeChangeConfigPatch,
  normalizeChangeTarget,
  selfChangeContentHash,
  selfChangeOutcome,
  sha256Hex,
  type SelfChangeFileEntry,
} from '../../src/self-change/policy.js';
import { createHostProtectedPaths, type HostProtectedPaths } from '../../src/security/host-config-paths.js';

let root: string;
let protectedPaths: HostProtectedPaths;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'zhin-change-policy-'));
  protectedPaths = await createHostProtectedPaths({ projectRoot: root });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('self-change state machine', () => {
  it('only moves forward', () => {
    const happy = ['draft', 'trialing', 'ready', 'pending', 'approved', 'applying', 'verifying', 'applied'] as const;
    for (let i = 0; i < happy.length - 1; i++) expect(canTransitionSelfChange(happy[i]!, happy[i + 1]!)).toBe(true);
    expect(canTransitionSelfChange('ready', 'draft')).toBe(false);
    expect(canTransitionSelfChange('pending', 'ready')).toBe(false);
    expect(canTransitionSelfChange('applied', 'applying')).toBe(false);
    expect(canTransitionSelfChange('approved', 'pending')).toBe(false);
  });

  it('has no way out of terminal states', () => {
    for (const status of SELF_CHANGE_STATUSES) {
      if (!isSelfChangeTerminal(status)) continue;
      for (const to of SELF_CHANGE_STATUSES) expect(canTransitionSelfChange(status, to)).toBe(false);
    }
  });
});

describe('change target whitelist', () => {
  const policy = () => ({ projectRoot: root, protectedPaths, pluginRoots: ['plugins/weather'] });

  it.each([
    ['commands/ping.ts', 'commands/ping.ts'],
    ['./tools/search/index.ts', 'tools/search/index.ts'],
    ['handlers/message/receive.ts', 'handlers/message/receive.ts'],
    ['AGENTS.md', 'AGENTS.md'],
    ['BOT.md', 'BOT.md'],
    ['skills/weather/SKILL.md', 'skills/weather/SKILL.md'],
    ['plugins/weather/commands/today.ts', 'plugins/weather/commands/today.ts'],
    ['agents\\helper\\agent.json', 'agents/helper/agent.json'],
  ])('allows %s', (input, expected) => {
    expect(normalizeChangeTarget(input, policy())).toBe(expected);
  });

  it.each([
    'zhin.config.yml',
    'package.json',
    'pnpm-lock.yaml',
    'node_modules/zhin.js/lib/index.js',
    'commands/node_modules/x.js',
    '.zhin/changes/x/change.json',
    '.env',
    '.git/hooks/pre-commit',
    'plugin.ts',
    'src/index.ts',
    'packages/im/core/src/index.ts',
    'plugins/other/commands/x.ts',
    'commands',
    '../outside/commands/x.ts',
    'commands/../../etc/passwd',
    '/etc/passwd',
    'C:/Windows/x.ts',
    '',
  ])('rejects %j', (input) => {
    expect(() => normalizeChangeTarget(input, policy())).toThrow(SelfChangePathError);
  });

  it('fails closed without injected protected paths', () => {
    expect(() => normalizeChangeTarget('commands/pnpm-lock.yaml', { projectRoot: root })).toThrow(SelfChangePathError);
    expect(normalizeChangeTarget('commands/ping.ts', { projectRoot: root })).toBe('commands/ping.ts');
  });
});

describe('config patch', () => {
  it('keeps field-level operations', () => {
    const patch = normalizeChangeConfigPatch({
      expectedRevision: 'r1',
      patches: [{ op: 'set', path: ['ai', 'trigger', 'ambient', 'enabled'], value: true }, { op: 'remove', path: ['weather', 'key'] }],
    });
    expect(patch.patches).toHaveLength(2);
    expect(Object.isFrozen(patch.patches[0]!.path)).toBe(true);
  });

  it.each([
    [['ai', 'agent', 'toolHardGate']],
    [['ai', 'agent', 'toolHardGate', 'imApproval', 'enabled']],
    [['ai', 'agent', 'execApprovalMode']],
    [['ai', 'agent', 'masterShell']],
    [['ai', 'agent']],
    [['ai']],
  ])('rejects a patch touching %j', (segments) => {
    expect(() => normalizeChangeConfigPatch({ expectedRevision: 'r1', patches: [{ op: 'set', path: segments, value: {} }] }))
      .toThrow(SelfChangeConfigKeyError);
    expect(() => normalizeChangeConfigPatch({ expectedRevision: 'r1', patches: [{ op: 'remove', path: segments }] }))
      .toThrow(SelfChangeConfigKeyError);
  });

  it.each(SELF_CHANGE_SECURITY_CONFIG_KEYS.map(key => [key]))('rejects set, remove and nested writes of security key %s', (key) => {
    const segments = key.split('.');
    const nested = [...segments, 'child'];
    for (const path of [segments, nested]) {
      expect(() => normalizeChangeConfigPatch({ expectedRevision: 'r1', patches: [{ op: 'set', path, value: {} }] }))
        .toThrow(SelfChangeConfigKeyError);
      expect(() => normalizeChangeConfigPatch({ expectedRevision: 'r1', patches: [{ op: 'remove', path }] }))
        .toThrow(SelfChangeConfigKeyError);
    }
  });

  it.each(SELF_CHANGE_SECURITY_CONFIG_KEYS.map(key => [key]))('rejects overwriting or removing every ancestor of %s', (key) => {
    const segments = key.split('.');
    for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestor = segments.slice(0, depth);
      expect(() => normalizeChangeConfigPatch({ expectedRevision: 'r1', patches: [{ op: 'set', path: ancestor, value: {} }] }))
        .toThrow(SelfChangeConfigKeyError);
      expect(() => normalizeChangeConfigPatch({ expectedRevision: 'r1', patches: [{ op: 'remove', path: ancestor }] }))
        .toThrow(SelfChangeConfigKeyError);
    }
  });

  it('rejects a mixed patch when any single operation touches a security key', () => {
    const input = {
      expectedRevision: 'r1',
      patches: [
        { op: 'set', path: ['ai', 'agent', 'maxIterations'], value: 8 },
        { op: 'set', path: ['console', 'terminal', 'enabled'], value: true },
      ],
    };
    expect(() => normalizeChangeConfigPatch(input)).toThrow(SelfChangeConfigKeyError);
  });

  it('keeps the dotted list and the segment list in sync', () => {
    expect(FORBIDDEN_CHANGE_CONFIG_KEYS.map(segments => segments.join('.'))).toEqual([...SELF_CHANGE_SECURITY_CONFIG_KEYS]);
    expect(new Set(SELF_CHANGE_SECURITY_CONFIG_KEYS).size).toBe(SELF_CHANGE_SECURITY_CONFIG_KEYS.length);
  });

  it('finds the forbidden key a path touches and re-checks normalized patches', () => {
    expect(findForbiddenConfigKey(['ai', 'agent', 'execSecurity', 'mode'])).toEqual(['ai', 'agent', 'execSecurity']);
    expect(findForbiddenConfigKey(['ai', 'agent', 'maxIterations'])).toBeNull();
    const allowed = normalizeChangeConfigPatch({ expectedRevision: 'r1', patches: [{ op: 'set', path: ['weather', 'unit'], value: 'c' }] });
    expect(() => assertConfigPatchAllowed(allowed)).not.toThrow();
    const stale = { expectedRevision: 'r1', patches: [{ op: 'set' as const, path: ['mcp', 'enabled'], value: true }] };
    expect(() => assertConfigPatchAllowed(stale)).toThrow(SelfChangeConfigKeyError);
  });

  it('allows siblings of forbidden keys', () => {
    expect(() => normalizeChangeConfigPatch({ expectedRevision: 'r1', patches: [{ op: 'set', path: ['ai', 'agent', 'maxIterations'], value: 8 }] }))
      .not.toThrow();
  });

  it.each([
    null,
    { patches: [{ op: 'set', path: ['a'], value: 1 }] },
    { expectedRevision: 'r', patches: [] },
    { expectedRevision: 'r', patches: [{ op: 'merge', path: ['a'] }] },
    { expectedRevision: 'r', patches: [{ op: 'set', path: [] }] },
    { expectedRevision: 'r', patches: [{ op: 'set', path: [''] }] },
  ])('rejects malformed patch %j', (input) => {
    expect(() => normalizeChangeConfigPatch(input)).toThrow(SelfChangeValidationError);
  });
});

describe('content_hash', () => {
  const file = (path: string, content: string): SelfChangeFileEntry => ({ path, op: 'write', sha256: sha256Hex(content), bytes: content.length });
  const patch = normalizeChangeConfigPatch({ expectedRevision: 'r1', patches: [{ op: 'set', path: ['x', 'y'], value: { b: 1, a: 2 } }] });

  it('ignores file order and object key order', () => {
    const a = selfChangeContentHash([file('commands/a.ts', 'a'), file('commands/b.ts', 'b')], patch);
    const b = selfChangeContentHash([file('commands/b.ts', 'b'), file('commands/a.ts', 'a')],
      normalizeChangeConfigPatch({ expectedRevision: 'r1', patches: [{ op: 'set', path: ['x', 'y'], value: { a: 2, b: 1 } }] }));
    expect(a).toBe(b);
  });

  it('changes with content, deletions and the patch', () => {
    const base = selfChangeContentHash([file('commands/a.ts', 'a')], null);
    expect(selfChangeContentHash([file('commands/a.ts', 'A')], null)).not.toBe(base);
    expect(selfChangeContentHash([{ path: 'commands/a.ts', op: 'delete', sha256: null, bytes: 0 }], null)).not.toBe(base);
    expect(selfChangeContentHash([file('commands/a.ts', 'a')], patch)).not.toBe(base);
  });
});

// ── 守卫：schema 安全标记 ⇔ 禁改名单 ───────────────────────────────────────────

type SchemaNode = Readonly<Record<string, unknown>>;

const HOST_CONFIG_SCHEMA_URL = new URL('../../../runtime/src/host-config-schema.json', import.meta.url);

function isSchemaNode(value: unknown): value is SchemaNode {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 只沿 `properties` 走（宿主配置的固定字段）；返回所有标了 `x-zhin-config.security` 的点分路径。 */
function collectSecurityTaggedKeys(node: SchemaNode, path: readonly string[], found: string[]): string[] {
  const metadata = node['x-zhin-config'];
  if (isSchemaNode(metadata) && metadata.security === true) found.push(path.join('.'));
  const properties = node.properties;
  if (!isSchemaNode(properties)) return found;
  for (const [key, child] of Object.entries(properties)) {
    if (isSchemaNode(child)) collectSecurityTaggedKeys(child, [...path, key], found);
  }
  return found;
}

describe('host config schema security tags', () => {
  const hostSchema = JSON.parse(readFileSync(HOST_CONFIG_SCHEMA_URL, 'utf8')) as SchemaNode;
  const taggedKeys = collectSecurityTaggedKeys(hostSchema, [], []);

  it('rejects every schema key tagged as security-sensitive', () => {
    for (const key of taggedKeys) {
      expect(SELF_CHANGE_SECURITY_CONFIG_KEYS, `${key} is tagged security in host-config-schema.json`).toContain(key);
      expect(() => normalizeChangeConfigPatch({ expectedRevision: 'r1', patches: [{ op: 'remove', path: key.split('.') }] }))
        .toThrow(SelfChangeConfigKeyError);
    }
  });

  it('tags every forbidden key in the schema', () => {
    expect([...taggedKeys].sort()).toEqual([...SELF_CHANGE_SECURITY_CONFIG_KEYS].sort());
  });
});

describe('decision outcome', () => {
  // The change record ends `failed` (stopped for manual verification); the decision event stays `defer`.
  it.each(['change_config_unconfirmed', 'change_config_superseded'] as const)('maps %s to defer, not error or deny', code => {
    expect(selfChangeOutcome(code)).toBe('defer');
  });
});
