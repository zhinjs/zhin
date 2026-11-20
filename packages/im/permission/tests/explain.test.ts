import {
  checkBuiltinPermit, describeCommandDenial, describeConversationManagerDenial, describeDeniedPermit, describeGlobalOwnerRequired,
  explainPermitRules, type PermissionSubject,
} from '../src/index.js';

const subject: PermissionSubject = { adapter: 'root/qq-work', scene: { type: 'group', id: 'g1' },
  sender: { id: 'u1', chatRole: 'owner', platform: { standing: 'admin', permissions: ['kick'] } } };

it.each([
  'adapter(qq)', 'adapter(root/qq-work)', 'adapter(*)', 'adapter(slack)',
  'group()', 'group(*)', 'group(g1,g2)', 'group(g2)', 'private()', 'channel(g1)',
  'user(u1,u2)', 'user()', 'user(u2)', 'owner', 'role(trusted)', 'role(admin)', 'role(owner,admin)',
  'platform:admin', 'platform:owner', 'platform-permission:kick', 'platform-role:r1',
])('uses the actual builtin checker for %s', rule => {
  const [row] = explainPermitRules([rule], subject, { rolesKnown: true });
  expect(row?.outcome).toBe(checkBuiltinPermit(rule, subject) ? 'match' : 'mismatch');
  expect(row?.reason).toContain('单项内多个值为 OR，规则之间为 AND');
});

it('preserves unknown identity and roles rather than manufacturing a denial or verified role', () => {
  expect(explainPermitRules(['group()', 'user(u1)', 'trusted', 'adapter(qq)', 'platform:admin']).map(item => item.outcome)).toEqual(Array(5).fill('unknown'));
  expect(explainPermitRules(['owner'], subject)[0]?.outcome).toBe('unknown');
  expect(explainPermitRules(['user(u1)'], subject)[0]?.outcome).toBe('match');
  expect(explainPermitRules(['trusted'], { sender: { id: 'u1' } }, { rolesKnown: true })[0]?.outcome).toBe('mismatch');
});

it('does not execute custom rules and names the replacement of removed spellings', () => {
  expect(explainPermitRules(['platform(qq,admin)', 'arbitrary', 'role(master)'], subject)).toMatchObject([
    { kind: 'unknown', outcome: 'mismatch', reason: 'platform(qq,admin) → platform-permission:admin' },
    { kind: 'unknown', outcome: 'not_evaluated' },
    { kind: 'unknown', outcome: 'mismatch', reason: 'role(master) → role(owner)' },
  ]);
});

it('returns frozen rule rows and preserves parsed wildcard semantics', () => {
  const rows = explainPermitRules(['group()', 'adapter(*)'], subject);
  expect(rows[0]?.values).toEqual(['']); expect(rows[1]?.outcome).toBe('mismatch');
  expect(Object.isFrozen(rows)).toBe(true); expect(Object.isFrozen(rows[0])).toBe(true); expect(Object.isFrozen(rows[0]?.values)).toBe(true);
});

it('localizes explanations without changing rule outcomes or evaluating custom rules', () => {
  const rules = ['group(g1)', 'owner', 'user(u2)', 'private()', 'platform:admin', 'custom'];
  const chinese = explainPermitRules(rules, subject, { rolesKnown: true });
  const english = explainPermitRules(rules, subject, { rolesKnown: true, locale: 'en' });
  expect(english.map(({ reason: _reason, ...row }) => row))
    .toEqual(chinese.map(({ reason: _reason, ...row }) => row));
  expect(english.every(row => !/\p{Script=Han}/u.test(row.reason))).toBe(true);
  expect(chinese[0]?.reason).toContain('单项内多个值为 OR');
  expect(english[0]?.reason).toContain('OR');
});

describe('shared refusal texts (#1250 第 78 批)', () => {
  it('a global-owner requirement says where a global owner is granted, the same text everywhere', () => {
    const zh = describeGlobalOwnerRequired('zh-CN');
    expect(zh).toContain('仅全局聊天主人');
    expect(zh).toContain('Console「聊天角色」');
    expect(zh).toContain('认领 <码>');
    expect(describeGlobalOwnerRequired('zh-CN', { privateChat: true })).toContain('私聊中使用');
    expect(describeGlobalOwnerRequired('en')).toMatch(/^Only a global chat owner can use this command\. Global owners are granted/u);
    expect(describeCommandDenial('owner@global', 'zh-CN')).toBe(zh);
    expect(describeCommandDenial('role(owner@global)', 'en')).toBe(describeGlobalOwnerRequired('en'));
    expect(describeDeniedPermit('owner@global', 'zh-CN')).toContain('需要全局聊天主人');
  });

  it('other role conditions never name the role; standing holders learn it is not a zhin role', () => {
    expect(describeCommandDenial('role(admin)', 'zh-CN')).toBe('没有权限执行此指令：它需要 zhin 角色。请联系本机器人的主人授予，或由主人在 Console「聊天角色」页授予。');
    expect(describeCommandDenial('owner@adapter', 'zh-CN')).not.toContain('owner');
    expect(describeCommandDenial('trusted', 'zh-CN', { standing: 'admin' })).toContain('群主 / 群管理员的平台身份不等于 zhin 角色');
  });

  it('place, platform and generic denials', () => {
    expect(describeCommandDenial('private()', 'zh-CN')).toBe('此指令只能在私聊中使用，请私聊机器人发送。');
    expect(describeCommandDenial('private(u1)', 'zh-CN')).toBe('没有权限执行此指令。');
    expect(describeCommandDenial('group()', 'en')).toBe('You do not have permission to run this command.');
    expect(describeCommandDenial(undefined, 'zh-CN')).toBe('没有权限执行此指令。');
    expect(describeCommandDenial('custom.permit', 'zh-CN')).toBe('没有权限执行此指令。');
    expect(describeCommandDenial('bot:admin', 'zh-CN')).toBe('无法执行此指令：机器人不是本群管理员（或无法确认其身份）。');
    expect(describeCommandDenial('platform:admin', 'zh-CN', { reason: 'r' })).toBe('无法执行此指令：r');
    expect(describeConversationManagerDenial('zh-CN')).toContain('admin');
    expect(describeConversationManagerDenial('en')).toContain('private chat');
  });
});
