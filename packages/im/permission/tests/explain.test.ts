import { checkBuiltinPermit, explainPermitRules, type PermissionSubject } from '../src/index.js';

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
