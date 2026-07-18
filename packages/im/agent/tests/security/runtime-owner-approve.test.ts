import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyntheticMessage } from '@zhin.js/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  handleRuntimeOwnerApproveCommand,
  hasOwnerApproveAlways,
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

  it('returns null for non-approve text', () => {
    expect(handleRuntimeOwnerApproveCommand(ownerMessage(), 'hello')).toBeNull();
  });

  it('rejects non-owner private chat', () => {
    const msg = createSyntheticMessage({
      adapter: 'icqq',
      endpoint: '8596238',
      sender: { id: 'other', name: 'x' },
      channel: { type: 'private', id: 'other' },
      extra: { endpointMaster: '1659488338' },
    });
    expect(handleRuntimeOwnerApproveCommand(msg, '/approve always bash')).toMatch(/仅 Endpoint Owner/);
  });

  it('sets bash always and persists', () => {
    const msg = ownerMessage();
    const reply = handleRuntimeOwnerApproveCommand(msg, '/approve always bash');
    expect(reply).toMatch(/永久放行/);
    expect(hasOwnerApproveAlways(null, msg, OWNER_APPROVE_ALWAYS_TOOL)).toBe(true);
    expect(fs.existsSync(path.join(getDataDir(), 'owner-approve-always.json'))).toBe(true);
  });

  it('lists and revokes', () => {
    const msg = ownerMessage();
    handleRuntimeOwnerApproveCommand(msg, '/approve always bash');
    expect(handleRuntimeOwnerApproveCommand(msg, '/approve list')).toMatch(/bash 永久放行: 是/);
    expect(handleRuntimeOwnerApproveCommand(msg, '/approve revoke')).toMatch(/已撤销/);
    expect(hasOwnerApproveAlways(null, msg, OWNER_APPROVE_ALWAYS_TOOL)).toBe(false);
  });
});
