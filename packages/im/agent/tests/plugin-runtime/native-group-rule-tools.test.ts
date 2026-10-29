import { describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { AiGroupRules, type GroupRuleTransition } from '../../src/group-rules.js';
import type { DecisionEventInput } from '../../src/decision-events.js';
import { GROUP_RULE_DRAFT_TOOL_NAME, createNativeGroupRuleToolFeatures } from '../../src/plugin-runtime/native-group-rule-tools.js';
import { RESERVED_TOOL_NAMES } from '../../src/reserved-tools.js';

function harness() {
  const events: DecisionEventInput[] = [];
  const store = new AiGroupRules({ audit: () => ({ record: (input) => { events.push(input); } }) });
  const transitions: GroupRuleTransition[] = [];
  store.onTransition((transition) => transitions.push(transition));
  const [feature] = createNativeGroupRuleToolFeatures(() => store);
  return { store, events, transitions, tool: feature! };
}

function toolContext(roles: string[], origin: Partial<Extract<ToolExecutionContext['origin'], { kind: 'im' }>> = {}): ToolExecutionContext {
  return {
    locale: 'zh-CN',
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn-1',
    sessionKey: 'session',
    origin: { kind: 'im', platform: 'icqq', endpoint: '10086', scope: 'group', sceneId: '123', ...origin },
    principal: { subjectId: 'u-42', roles },
    policy: {},
  } as unknown as ToolExecutionContext;
}

const input = {
  trigger: 'advertising',
  ladder: [{ action: 'remind' }, { action: 'mute', duration_sec: 600 }],
  summary: '发广告的先提醒，再犯禁言十分钟',
};

describe('rule_draft tool', () => {
  it('is safe, group-only and reserved', () => {
    const { tool } = harness();
    expect(tool.name).toBe(GROUP_RULE_DRAFT_TOOL_NAME);
    expect(tool.definition.risk).toBe('safe');
    expect(tool.definition.requiresApproval).toBe('never');
    expect(tool.definition.scopes).toEqual(['group']);
    expect(RESERVED_TOOL_NAMES).toContain('rule_draft');
  });

  it('lets a group admin draft and submit a rule for the current group, never activating it', async () => {
    const { store, events, transitions, tool } = harness();
    const result = await tool.definition.execute(input, toolContext(['user', 'admin']));
    expect(result).toContain('NOT active');
    const [rule] = await store.list({ platform: 'icqq', sceneId: 'group:123' });
    expect(rule).toMatchObject({
      status: 'pending',
      trigger: 'advertising',
      createdVia: 'model',
      createdBy: 'u-42',
      ladder: [{ action: 'remind' }, { action: 'mute', durationSec: 600 }],
      windowMs: 30 * 60 * 1000,
    });
    expect(result).toContain(rule!.contentHash.slice(0, 8));
    expect(events.map((event) => event.reasonCode)).toEqual(['rule_drafted', 'rule_submitted']);
    expect(transitions.at(-1)).toMatchObject({ reasonCode: 'rule_submitted', endpoint: '10086' });
  });

  it('honours window and exempt list', async () => {
    const { store, tool } = harness();
    await tool.definition.execute({ ...input, window_minutes: 10, exempt_user_ids: ['7', 8] }, toolContext(['owner']));
    const [rule] = await store.list({ platform: 'icqq', sceneId: 'group:123' });
    expect(rule).toMatchObject({ windowMs: 600_000, exempt: { ownerAndAdmins: true, userIds: ['7', '8'] } });
  });

  it('refuses ordinary members and audits rule_draft_forbidden', async () => {
    const { store, events, tool } = harness();
    await expect(tool.definition.execute(input, toolContext(['user']))).rejects.toThrow(/owner or an admin/);
    expect(await store.list({ platform: 'icqq', sceneId: 'group:123' })).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'group_rule', outcome: 'deny', reasonCode: 'rule_draft_forbidden', actorId: 'u-42', sceneId: 'group:123' });
  });

  it('refuses outside a group', async () => {
    const { tool } = harness();
    await expect(tool.definition.execute(input, toolContext(['owner'], { scope: 'private', sceneId: '42' }))).rejects.toThrow(/group chat/);
  });

  it('surfaces store validation (mute out of range)', async () => {
    const { tool } = harness();
    await expect(tool.definition.execute({ ...input, ladder: [{ action: 'mute', duration_sec: 5 }] }, toolContext(['admin']))).rejects.toThrow();
  });
});
