import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OwnerApprovalRuntime } from '../../src/security/owner-approval-runtime.js';

describe('OwnerApprovalRuntime', () => {
  let workspace: string;
  const address = { platform: 'icqq', endpoint: 'bot1', ownerId: 'owner99' };

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-owner-approval-'));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('persists endpoint-scoped bash policy through an explicit runtime', () => {
    const runtime = new OwnerApprovalRuntime(workspace);
    expect(runtime.has(address, 'bash')).toBe(false);

    runtime.setBashAlways(address, true);

    expect(runtime.has(address, 'bash')).toBe(true);
    expect(new OwnerApprovalRuntime(workspace).has(address, 'bash')).toBe(true);
    expect(new OwnerApprovalRuntime(`${workspace}-other`).has(address, 'bash')).toBe(false);
    runtime.setBashAlways(address, false);
    expect(runtime.has(address, 'bash')).toBe(false);
  });

  it('matches rules against the complete command without fixing arguments', () => {
    const runtime = new OwnerApprovalRuntime(workspace);
    expect(runtime.addBashRule(address, '^icqq\\s+friend\\s+like\\b').ok).toBe(true);

    expect(runtime.matchesBashBypass(address, 'icqq friend like 999')).toBe(true);
    expect(runtime.matchesBashBypass(address, 'icqq friend like 111')).toBe(true);
    expect(runtime.matchesBashBypass(address, 'icqq group kick 1 2')).toBe(false);
  });

  it('rejects legacy documents without rewriting them', () => {
    const file = path.join(workspace, 'data', 'owner-approve-always.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const legacy = JSON.stringify({ version: 1, entries: ['icqq|bot1|owner99|orchestration:bash'] });
    fs.writeFileSync(file, legacy);

    const runtime = new OwnerApprovalRuntime(workspace);

    expect(() => runtime.has(address, 'bash')).toThrow(/Owner approval store is invalid/);
    expect(fs.readFileSync(file, 'utf-8')).toBe(legacy);
  });
});
