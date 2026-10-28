import { describe, expect, it, vi } from 'vitest';
import { AiGroupRules, DecisionEventLog, groupRuleContentHash, normalizeGroupRuleSpec } from '@zhin.js/agent';
import {
  DEFAULT_GROUP_RULE_MUTE_SEC,
  GROUP_RULE_MIGRATION_ACTOR,
  GroupRuleDefaults,
  defaultGroupRuleTemplate,
} from '../../../../src/plugin-runtime/agent/turn/group-rule-defaults.js';

const input = { platform: 'icqq', endpoint: '10086', groupId: '123', trigger: 'advertising' as const };

describe('GroupRuleDefaults (ADR 0039 slice E migration)', () => {
  it('matches the former hard-coded ladder: remind → warn → mute 600s, 30 min quiet window, owners/admins exempt', () => {
    const spec = normalizeGroupRuleSpec(defaultGroupRuleTemplate('abuse'));
    expect(spec).toMatchObject({
      trigger: 'abuse',
      ladder: [{ action: 'remind' }, { action: 'warn' }, { action: 'mute', durationSec: DEFAULT_GROUP_RULE_MUTE_SEC }],
      windowMs: 30 * 60_000,
      exempt: { ownerAndAdmins: true, userIds: [] },
    });
  });

  it('creates one pending rule per group and trigger, announcing it for confirmation (acceptance 7)', async () => {
    const log = new DecisionEventLog();
    const store = new AiGroupRules({ audit: () => log });
    const transitions: string[] = [];
    store.onTransition((transition) => transitions.push(`${transition.reasonCode}@${transition.endpoint ?? '-'}`));
    const defaults = new GroupRuleDefaults(() => store);

    const [first, concurrent] = await Promise.all([defaults.ensure(input), defaults.ensure(input)]);
    expect(first).toBe('created');
    expect(concurrent).toBe('created');
    await expect(defaults.ensure(input)).resolves.toBe('exists');
    await expect(defaults.ensure({ ...input, trigger: 'abuse' })).resolves.toBe('created');

    const rules = await store.list({ platform: 'icqq', sceneId: 'group:123' });
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule).toMatchObject({ status: 'pending', createdBy: GROUP_RULE_MIGRATION_ACTOR, approvedBy: null });
      expect(rule.contentHash).toBe(groupRuleContentHash({ platform: 'icqq', sceneId: 'group:123' }, normalizeGroupRuleSpec(rule)));
    }
    expect(await store.getActive({ platform: 'icqq', sceneId: 'group:123', trigger: 'advertising' })).toBeNull();
    expect(transitions).toEqual(['rule_drafted@-', 'rule_submitted@10086', 'rule_drafted@-', 'rule_submitted@10086']);
  });

  it('does not recreate a rule the group already rejected or disabled', async () => {
    const store = new AiGroupRules();
    const defaults = new GroupRuleDefaults(() => store);
    await defaults.ensure(input);
    const [pending] = await store.list({ platform: 'icqq', sceneId: 'group:123' });
    await store.reject({ id: pending!.id, expectedRevision: pending!.revision, actorId: 'owner-1' });
    const create = vi.spyOn(store, 'create');
    await expect(defaults.ensure(input)).resolves.toBe('exists');
    expect(create).not.toHaveBeenCalled();
  });

  it('reports unavailable without a rule store', async () => {
    await expect(new GroupRuleDefaults(() => undefined).ensure(input)).resolves.toBe('unavailable');
  });
});
