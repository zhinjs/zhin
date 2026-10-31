import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OwnerApprovalRuntime } from '../../src/security/owner-approval-runtime.js';

describe('OwnerApprovalRuntime', () => {
  let workspace: string;
  const address = { endpoint: { adapter: 'icqq', id: 'bot1' }, ownerId: 'owner99' };

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

it('keeps V2 grants readonly and preserves them when a fresh canonical grant is written', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-owner-v2-'));
  try {
    const file = path.join(workspace, 'data', 'owner-approve-always.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const entry = { bashAlways: true, bashRules: [{ id: 'old-rule', pattern: '^ls', createdAt: 1 }] };
    const legacy = JSON.stringify({ version: 2, endpoints: { 'icqq|bot|owner': entry } });
    fs.writeFileSync(file, legacy);
    const runtime = new OwnerApprovalRuntime(workspace);
    const address = { endpoint: { adapter: 'icqq', id: 'canonical-a' }, ownerId: 'owner' };
    expect(runtime.has(address, 'bash')).toBe(false);
    expect(runtime.matchesBashBypass(address, 'ls')).toBe(false);
    expect(runtime.previewHistoricalApprovals().candidates).toMatchObject([{ status: 'unresolved', executable: false,
      summary: { requiresFreshAuthorization: true, ruleCount: 1 } }]);
    expect(fs.readFileSync(file, 'utf8')).toBe(legacy);
    runtime.setBashAlways(address, true);
    expect(runtime.has(address, 'bash')).toBe(true);
    expect(runtime.has({ ...address, endpoint: { ...address.endpoint, id: 'canonical-b' } }, 'bash')).toBe(false);
    expect(runtime.has({ ...address, endpoint: { ...address.endpoint, adapter: 'other' } }, 'bash')).toBe(false);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(stored.version).toBe(3);
    expect(stored.legacyEndpoints).toEqual({ 'icqq|bot|owner': entry });
    expect(new OwnerApprovalRuntime(workspace).has(address, 'bash')).toBe(true);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});

it('does not use the presentation account name instead of the canonical message identity', async () => {
  const { createSyntheticMessage } = await import('@zhin.js/core');
  const { ownerApprovalAddressFromMessage } = await import('../../src/security/owner-approval-runtime.js');
  const message = createSyntheticMessage({ conversation: { endpoint: { adapter: 'icqq', id: 'canonical-new' }, kind: 'private', id: 'owner' },
    endpointId: 'reusable-name', clientAdapter: 'icqq', extra: { endpointMaster: 'owner' } });
  expect(ownerApprovalAddressFromMessage(message)).toEqual({ endpoint: { adapter: 'icqq', id: 'canonical-new' }, ownerId: 'owner' });
});
