import { describe, expect, it } from 'vitest';
import { AiGroupRules, DecisionEventLog } from '@zhin.js/agent';
import { AssistantStatus } from '../../../src/plugin-runtime/console/assistant-status.js';
import {
  GROUP_RULES_APPROVE_PERMISSION,
  GROUP_RULES_READ_PERMISSION,
  GROUP_RULES_WRITE_PERMISSION,
} from '../../../src/plugin-runtime/console/group-rules-rpc.js';

const signal = new AbortController().signal;
const scene = { platform: 'icqq', sceneId: 'group:123' };
const spec = { trigger: 'advertising', ladder: [{ action: 'remind' }, { action: 'mute', durationSec: 600 }], content: '广告先提醒再禁言' };

function harness(bound = true) {
  const status = new AssistantStatus();
  const log = new DecisionEventLog();
  const store = new AiGroupRules({ audit: () => log });
  if (bound) status.bindGroupRules(() => store);
  const call = (name: string, input: Record<string, unknown> = {}) =>
    Promise.resolve().then(() => status.consoleRpc.methods.get(name)!.handler(input as never, { signal })) as Promise<Record<string, any>>;
  return { status, store, log, call };
}

describe('group rules Console RPC', () => {
  it('declares read / write / approve permissions', () => {
    const { status } = harness();
    const perms = (name: string) => status.consoleRpc.methods.get(name)!.requiredPermissions;
    expect(perms('group-rules')).toEqual([GROUP_RULES_READ_PERMISSION]);
    expect(perms('group-rule')).toEqual([GROUP_RULES_READ_PERMISSION]);
    expect(perms('group-rule-create')).toEqual([GROUP_RULES_WRITE_PERMISSION]);
    expect(perms('group-rule-disable')).toEqual([GROUP_RULES_WRITE_PERMISSION]);
    expect(perms('group-rule-approve')).toEqual([GROUP_RULES_APPROVE_PERMISSION]);
    expect(perms('group-rule-reject')).toEqual([GROUP_RULES_APPROVE_PERMISSION]);
  });

  it('creates (submitted), lists, approves with hash, and disables', async () => {
    const { call } = harness();
    const created = await call('group-rule-create', { ...scene, ...spec });
    expect(created).toMatchObject({ to: 'pending', reasonCode: 'rule_submitted', rule: { createdVia: 'console', status: 'pending' } });
    const list = await call('group-rules', scene);
    expect(list.rules).toHaveLength(1);
    const rule = list.rules[0];
    await expect(call('group-rule-approve', { id: rule.id, expectedRevision: rule.revision, contentHash: 'nope' })).rejects.toMatchObject({ code: 'conflict' });
    const approved = await call('group-rule-approve', { id: rule.id, expectedRevision: rule.revision, contentHash: rule.contentHash });
    expect(approved).toMatchObject({ to: 'active', rule: { approvedVia: 'console', approvedBy: 'console' } });
    await expect(call('group-rule-disable', { id: rule.id, expectedRevision: rule.revision })).rejects.toMatchObject({ code: 'conflict' });
    const disabled = await call('group-rule-disable', { id: rule.id, expectedRevision: approved.rule.revision, reason: '活动结束' });
    expect(disabled).toMatchObject({ to: 'disabled', reasonCode: 'rule_disabled' });
    expect((await call('group-rule', { id: rule.id })).status).toBe('disabled');
  });

  it('rejects a pending rule', async () => {
    const { call } = harness();
    const created = await call('group-rule-create', { ...scene, ...spec });
    const rejected = await call('group-rule-reject', { id: created.rule.id, expectedRevision: created.rule.revision });
    expect(rejected).toMatchObject({ to: 'rejected' });
  });

  it('validates input and maps store errors', async () => {
    const { call } = harness();
    await expect(call('group-rules', { platform: 'icqq', sceneId: 'private:1' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('group-rule-create', { ...scene, ...spec, extra: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('group-rule-create', { ...scene, ...spec, ladder: [{ action: 'mute', durationSec: 1 }] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('group-rule', { id: 'missing' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('is unavailable until bound', async () => {
    const { call } = harness(false);
    await expect(call('group-rules', scene)).rejects.toMatchObject({ code: 'unavailable' });
  });
});
