import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyntheticMessage } from '@zhin.js/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describeGlobalOwnerRequired } from '@zhin.js/permission';
import {
  OwnerApprovalRuntime,
  ownerApprovalAddressFromMessage,
  OWNER_APPROVE_ALWAYS_TOOL,
} from '../../src/security/owner-approval-runtime.js';

describe('OwnerApprovalRuntime commands', () => {
  let tmp: string;
  let runtime: OwnerApprovalRuntime;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-approve-'));
    runtime = new OwnerApprovalRuntime(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function ownerMessage() {
    return createSyntheticMessage({
      conversation: { endpoint: { adapter: 'icqq', id: '8596238' }, kind: 'private', id: '1659488338' },
      endpointId: '8596238', clientAdapter: 'icqq',
      sender: { id: '1659488338', name: 'owner', chatRole: 'owner' },
      extra: { endpointMaster: '1659488338' },
    });
  }

  function ownerContext(subjectId = '1659488338', senderIsGlobalOwner = subjectId === '1659488338') {
    return {
      commandPrefix: '/',
      endpoint: { adapter: 'icqq', id: '8596238' },
      ownerId: '1659488338',
      subjectId,
      senderIsGlobalOwner,
      scope: 'private' as const,
    };
  }

  it('returns null for non-approve text', () => {
    expect(runtime.handleCommand(ownerContext(), 'hello')).toBeNull();
  });

  it('resolves owner approval identity from the canonical conversation endpoint', () => {
    const message = createSyntheticMessage({
      conversation: { endpoint: { adapter: 'icqq', id: '8596238' }, kind: 'private', id: '1659488338' },
      sender: { id: '1659488338', name: 'owner', chatRole: 'owner' },
      extra: { endpointMaster: '1659488338' },
    });
    expect(ownerApprovalAddressFromMessage(message)).toEqual({
      endpoint: { adapter: 'icqq', id: '8596238' },
      ownerId: '1659488338',
    });
  });

  it('rejects non-owner private chat', () => {
    const onUnauthorized = vi.fn();
    const denied = runtime.handleCommand({ ...ownerContext('other'), onUnauthorized }, '/approve always bash');
    expect(denied).toMatch(/仅全局聊天主人（global owner）/);
    // #1250: flagged as unauthorized (silent in a group); a global owner in a group is only told to use a private chat.
    expect(onUnauthorized).toHaveBeenCalledWith('not_global_owner');
    const ownerInGroup = vi.fn();
    expect(runtime.handleCommand({ ...ownerContext(), scope: 'group', onUnauthorized: ownerInGroup }, '/approve list')).toMatch(/仅全局聊天主人/);
    expect(ownerInGroup).not.toHaveBeenCalled();
    // #1250: the chat-role model (ADR 0056 / 0060), not a plugin config field; binding comes first.
    // The bind command is named with this account's actual prefix.
    expect(denied).toContain('「/绑定 <码>」');
    expect(denied).toBe(describeGlobalOwnerRequired('zh-CN', { privateChat: true, commandPrefix: '/' }));
    expect(denied).toContain('认领 <码>');
    expect(denied).toContain('「认领 <码>」');
    expect(denied).not.toMatch(/master|插件配置|本账号的聊天主人/);
    const deniedEn = runtime.handleCommand({ ...ownerContext('other'), locale: 'en' }, '/approve always bash');
    expect(deniedEn).toContain('Only a global chat owner');
    expect(deniedEn).toContain('「/bind <code>」');
  });

  it('accepts any global owner, not only the first one the account resolves to', () => {
    // A second global owner: the address (ownerId) stays the account's canonical owner key.
    const reply = runtime.handleCommand(ownerContext('second-owner', true), '/approve always bash');
    expect(reply).toMatch(/永久放行/);
    expect(runtime.has(ownerApprovalAddressFromMessage(ownerMessage())!, OWNER_APPROVE_ALWAYS_TOOL)).toBe(true);
    // The canonical owner id alone is not enough: the sender must be a global owner.
    expect(runtime.handleCommand(ownerContext('1659488338', false), '/approve list')).toMatch(/仅全局聊天主人/);
  });

  it('sets bash always and persists', () => {
    const msg = ownerMessage();
    const reply = runtime.handleCommand(ownerContext(), '/approve always bash');
    expect(reply).toMatch(/永久放行/);
    expect(runtime.has(ownerApprovalAddressFromMessage(msg)!, OWNER_APPROVE_ALWAYS_TOOL)).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'data', 'owner-approve-always.json'))).toBe(true);
  });

  it('lists and revokes', () => {
    const msg = ownerMessage();
    runtime.handleCommand(ownerContext(), '/approve always bash');
    expect(runtime.handleCommand(ownerContext(), '/approve list')).toMatch(/bash 永久放行: 是/);
    expect(runtime.handleCommand(ownerContext(), '/approve revoke')).toMatch(/已撤销/);
    expect(runtime.has(ownerApprovalAddressFromMessage(msg)!, OWNER_APPROVE_ALWAYS_TOOL)).toBe(false);
  });

  it('adds an approve rule via /approve rule <pattern>', () => {
    const msg = ownerMessage();
    expect(runtime.handleCommand(ownerContext(), '/approve rule ^ls')).toMatch(/已添加规则/);
    expect(runtime.handleCommand(ownerContext(), '/approve  rule   ^git status')).toMatch(/已添加规则/);
    const address = ownerApprovalAddressFromMessage(msg)!;
    expect(runtime.matchesBashBypass(address, 'ls -la')).toBe(true);
    expect(runtime.matchesBashBypass(address, 'git status --short')).toBe(true);
  });

  it('rejects /approve rule without an argument', () => {
    expect(runtime.handleCommand(ownerContext(), '/approve rule')).toMatch(/无法解析指令/);
    expect(runtime.handleCommand(ownerContext(), '/approve rule ')).toMatch(/无法解析指令/);
  });

  it('does not expose the removed pending-approval shorthand', () => {
    expect(runtime.handleCommand(ownerContext(), '/approve always')).toMatch(/无法解析指令/);
  });

  it('parses /approve rule with 100k whitespace in linear time (no ReDoS)', () => {
    const start = performance.now();
    const reply = runtime.handleCommand(ownerContext(), `/approve rule ${' '.repeat(100_000)}x`);
    expect(performance.now() - start).toBeLessThan(100);
    expect(reply).toMatch(/已添加规则/);
  });
});

it('uses the operation prefix and language without changing owner-only private approval', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-approval-locale-'));
  try {
    const runtime = new OwnerApprovalRuntime(workspace);
    const context = { endpoint: { adapter: 'fixture', id: 'bot' }, ownerId: 'owner', subjectId: 'owner', senderIsGlobalOwner: true,
      scope: 'private' as const, locale: 'en' as const, commandPrefix: '!' };
    expect(runtime.handleCommand(context, '!approve')).toContain('!approve always bash');
    expect(runtime.handleCommand(context, '/approve always bash')).toBeNull();
    expect(runtime.handleCommand({ ...context, commandPrefix: undefined }, '/approve always bash')).toBeNull();
    expect(runtime.handleCommand({ ...context, scope: 'group' }, '!approve always bash')).toContain('Only a global chat owner');
    const denied = runtime.handleCommand({ ...context, subjectId: 'other', senderIsGlobalOwner: false }, '!approve always bash');
    expect(denied).toContain('Only a global chat owner');
    expect(denied).toBe(describeGlobalOwnerRequired('en', { privateChat: true, commandPrefix: '!' }));
    expect(denied).toContain('「!bind <code>」');
    expect(denied).toContain('「claim <code>」');
    expect(denied).not.toMatch(/master|plugin configuration/);
    expect(runtime.handleCommand(context, '!approve rule [')).toContain('Invalid regular expression');
    expect(runtime.handleCommand(context, '!approve revoke rule missing')).toContain('no custom rules');
    expect(runtime.handleCommand(context, '!approve rule ^中文命令')).toContain('Added rule');
    expect(runtime.handleCommand(context, '!approve list')).toContain('^中文命令');
    expect(runtime.handleCommand(context, '!approve revoke rule missing')).toContain('No rule matches');
    expect(runtime.handleCommand({ ...context, commandPrefix: '' }, 'approve always bash')).toContain('Permanently approved bash');
    expect(runtime.handleCommand(context, '!approve revoke')).toContain('!approve list');
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});
