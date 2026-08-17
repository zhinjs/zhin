import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyntheticMessage } from '@zhin.js/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  handleRuntimeOwnerApproveCommand,
  hasOwnerApproveAlways,
  matchesBashOwnerExecBypass,
  OWNER_APPROVE_ALWAYS_TOOL,
} from '../../src/security/owner-approve-always-store.js';
import { getDataDir } from '../../src/discovery/utils.js';

describe('handleRuntimeOwnerApproveCommand', () => {
  let prevCwd: string;
  let tmp: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-approve-'));
    process.chdir(tmp);
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(prevCwd);
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
    expect(handleRuntimeOwnerApproveCommand(ownerContext(), 'hello')).toBeNull();
  });

  it('rejects non-owner private chat', () => {
    expect(handleRuntimeOwnerApproveCommand(ownerContext('other'), '/approve always bash')).toMatch(/仅 Endpoint Owner/);
  });

  it('sets bash always and persists', () => {
    const msg = ownerMessage();
    const reply = handleRuntimeOwnerApproveCommand(ownerContext(), '/approve always bash');
    expect(reply).toMatch(/永久放行/);
    expect(hasOwnerApproveAlways(null, msg, OWNER_APPROVE_ALWAYS_TOOL)).toBe(true);
    expect(fs.existsSync(path.join(getDataDir(), 'owner-approve-always.json'))).toBe(true);
  });

  it('lists and revokes', () => {
    const msg = ownerMessage();
    handleRuntimeOwnerApproveCommand(ownerContext(), '/approve always bash');
    expect(handleRuntimeOwnerApproveCommand(ownerContext(), '/approve list')).toMatch(/bash 永久放行: 是/);
    expect(handleRuntimeOwnerApproveCommand(ownerContext(), '/approve revoke')).toMatch(/已撤销/);
    expect(hasOwnerApproveAlways(null, msg, OWNER_APPROVE_ALWAYS_TOOL)).toBe(false);
  });

  it('adds an approve rule via /approve rule <pattern>', () => {
    const msg = ownerMessage();
    expect(handleRuntimeOwnerApproveCommand(ownerContext(), '/approve rule ^ls')).toMatch(/已添加规则/);
    expect(handleRuntimeOwnerApproveCommand(ownerContext(), '/approve  rule   ^git status')).toMatch(/已添加规则/);
    expect(matchesBashOwnerExecBypass(null, msg, 'ls -la')).toBe(true);
    expect(matchesBashOwnerExecBypass(null, msg, 'git status --short')).toBe(true);
  });

  it('rejects /approve rule without an argument', () => {
    expect(handleRuntimeOwnerApproveCommand(ownerContext(), '/approve rule')).toMatch(/无法解析指令/);
    expect(handleRuntimeOwnerApproveCommand(ownerContext(), '/approve rule ')).toMatch(/无法解析指令/);
  });

  it('parses /approve rule with 100k whitespace in linear time (no ReDoS)', () => {
    const start = performance.now();
    const reply = handleRuntimeOwnerApproveCommand(ownerContext(), `/approve rule ${' '.repeat(100_000)}x`);
    expect(performance.now() - start).toBeLessThan(100);
    expect(reply).toMatch(/已添加规则/);
  });
});
