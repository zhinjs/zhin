import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyntheticMessage } from '@zhin.js/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
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
      adapter: 'icqq',
      endpoint: '8596238',
      sender: { id: '1659488338', name: 'owner', isMaster: true },
      channel: { type: 'private', id: '1659488338' },
      extra: { endpointMaster: '1659488338' },
    });
  }

  function ownerContext(subjectId = '1659488338') {
    return {
      platform: 'icqq',
      endpoint: '8596238',
      ownerId: '1659488338',
      subjectId,
      scope: 'private' as const,
    };
  }

  it('returns null for non-approve text', () => {
    expect(runtime.handleCommand(ownerContext(), 'hello')).toBeNull();
  });

  it('rejects non-owner private chat', () => {
    expect(runtime.handleCommand(ownerContext('other'), '/approve always bash')).toMatch(/仅 Endpoint Owner/);
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
