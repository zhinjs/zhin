import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SELF_CHANGE_STATUSES,
  SelfChangeConfigKeyError,
  SelfChangePathError,
  SelfChangeValidationError,
  canTransitionSelfChange,
  isSelfChangeTerminal,
  normalizeChangeConfigPatch,
  normalizeChangeTarget,
  selfChangeContentHash,
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
