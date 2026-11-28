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
    expect(describeDeniedPermit('owner@global', 'zh-CN')).toContain('此功能需要全局聊天主人');
  });

  it('points a Sandbox-only project at 「以我的聊天身份发言」 instead of bind / claim codes (#1250 owner-hints-dead-end-sandbox-only)', () => {
    const zh = describeGlobalOwnerRequired('zh-CN', { simulationOnly: true });
    expect(zh).toMatch(/^仅全局聊天主人（global owner）可使用此指令。当前只装了模拟适配器（Sandbox）/u);
    expect(zh).toContain('在 Console 的 Sandbox 打开「以我的聊天身份发言」并发一条消息');
    expect(zh).toContain('console-<用户 id>');
    expect(zh).toContain('Console「聊天角色」页把全局 owner 授予这个身份');
    expect(zh).not.toContain('绑定 <码>');
    expect(zh).not.toContain('认领 <码>');
    const en = describeGlobalOwnerRequired('en', { simulationOnly: true, bindCommand: '/bind' });
    expect(en).toMatch(/^Only a global chat owner can use this command\. Only simulation adapters \(the Sandbox\) are loaded/u);
    expect(en).toContain('"Speak as my chat identity"');
    expect(en).not.toMatch(/bind <code>|claim <code>/u);
    expect(describeGlobalOwnerRequired('zh-CN', { privateChat: true, simulationOnly: true })).toContain('私聊中使用');
    // The same text from a declarative `owner@global` permit; without the flag nothing changes.
    expect(describeCommandDenial('owner@global', 'zh-CN', { simulationOnly: true })).toBe(zh);
    expect(describeDeniedPermit('owner@global', 'en', { simulationOnly: true })).toContain('"Speak as my chat identity"');
    expect(describeGlobalOwnerRequired('zh-CN', { simulationOnly: false })).toBe(describeGlobalOwnerRequired('zh-CN'));
  });

  it('names the bare bind word: 绑定 <码> needs no command prefix (#1250 bind-hint-omits-command-prefix)', () => {
    const zh = '先私聊机器人发送「绑定 <码>」（不需要命令前缀）把聊天身份绑定到 Console 账号';
    expect(describeGlobalOwnerRequired('zh-CN')).toContain(zh);
    // A known prefix or invocation no longer changes the text: the bare word works everywhere.
    expect(describeGlobalOwnerRequired('zh-CN', { bindCommand: '!!绑定' })).toContain(zh);
    expect(describeGlobalOwnerRequired('zh-CN', { commandPrefix: '#' })).toContain(zh);
    expect(describeGlobalOwnerRequired('en')).toContain('send 「bind <code>」 to the bot in a private chat (no command prefix needed).');
    expect(describeGlobalOwnerRequired('en', { bindCommand: '#bind' })).toBe(describeGlobalOwnerRequired('en'));
    expect(describeCommandDenial('owner@global', 'en', { bindCommand: '/bind' })).toBe(describeGlobalOwnerRequired('en'));
    expect(describeGlobalOwnerRequired('zh-CN')).not.toContain('带上前缀');
  });

  it('describeDeniedPermit returns complete sentences; only describeCommandDenial prefixes the command refusal', () => {
    expect(describeDeniedPermit('trusted', 'en')).toBe('This needs a zhin role. Ask the owner of this bot to grant one, in chat or on the Console "Chat roles" page.');
    expect(describeDeniedPermit('role(admin)', 'zh-CN')).toBe('此功能需要 zhin 角色。请联系本机器人的主人授予，或由主人在 Console「聊天角色」页授予。');
    expect(describeDeniedPermit('owner@global', 'en')).toMatch(/^This needs a global chat owner\. Global owners are granted/u);
    expect(describeCommandDenial('trusted', 'en')).toBe(`You do not have permission to run this command. ${describeDeniedPermit('trusted', 'en')}`);
    expect(describeCommandDenial('trusted', 'zh-CN')).toBe(`没有权限执行此指令。${describeDeniedPermit('trusted', 'zh-CN')}`);
  });

  it('other role conditions never name the role; standing holders learn it is not a zhin role', () => {
    expect(describeCommandDenial('role(admin)', 'zh-CN')).toBe('没有权限执行此指令。此功能需要 zhin 角色。请联系本机器人的主人授予，或由主人在 Console「聊天角色」页授予。');
    expect(describeCommandDenial('owner@adapter', 'zh-CN')).not.toContain('owner');
    expect(describeCommandDenial('trusted', 'zh-CN', { standing: 'admin' })).toContain('群主 / 群管理员的平台身份不等于 zhin 角色');
  });

  it('place, platform and generic denials', () => {
    expect(describeCommandDenial('private()', 'zh-CN')).toBe('此指令只能在私聊中使用，请私聊机器人发送。');
    expect(describeCommandDenial('private(u1)', 'zh-CN')).toBe('没有权限执行此指令。');
    expect(describeCommandDenial('group()', 'en')).toBe('You do not have permission to run this command.');
    expect(describeCommandDenial(undefined, 'zh-CN')).toBe('没有权限执行此指令。');
    expect(describeCommandDenial('custom.permit', 'zh-CN')).toBe('没有权限执行此指令。');
    expect(describeCommandDenial('bot:admin', 'zh-CN')).toBe('无法执行此指令。机器人不是本群管理员（或无法确认其身份）。');
    expect(describeCommandDenial('platform:admin', 'zh-CN', { reason: 'r' })).toBe('无法执行此指令。r');
    expect(describeConversationManagerDenial('zh-CN')).toContain('admin');
    expect(describeConversationManagerDenial('en')).toContain('private chat');
  });
});
