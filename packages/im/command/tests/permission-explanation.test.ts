import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { CommandIndex, commandFeatureId, defineCommand, explainCommandPermissions, toCommandPermissionSubject } from '../src/index.js';

const target = { endpoint: { id: 'endpoint-1', adapter: 'qq' }, kind: 'group', id: 'g1', parent: { kind: 'channel', id: 'parent' }, threadId: 'topic' };
const source = { conversation: target, content: '', clientAdapter: 'qq', sender: { id: 'u1', roles: ['master'] }, metadata: { roles: ['admin'], senderPermissions: ['manage'] } };

it('shares real command role precedence and the separate exact adapter gate', () => {
  expect(toCommandPermissionSubject(source)).toEqual({ adapter: 'qq', endpoint: 'endpoint-1', scene: { type: 'group', id: 'g1' },
    sender: { id: 'u1', role: ['master'], permissions: ['manage'] } });
  const result = explainCommandPermissions({ adapter: 'qq', permit: ['adapter(qq)', 'role(trusted)', 'role(admin)'] }, { source, rolesKnown: true, permissionHost: 'present' });
  expect(result.adapter.outcome).toBe('match'); expect(result.rules.map(item => item.outcome)).toEqual(['match', 'match', 'mismatch']);
  expect(result.summary.outcome).toBe('mismatch');
  expect(explainCommandPermissions({ adapter: 'root/qq' }, { source, permissionHost: 'present' }).adapter.outcome).toBe('mismatch');
});

it('keeps absent roles unknown and explicit canonical empty roles on the real default user path', () => {
  for (const conversation of [target, undefined]) {
    const input = { ...(conversation ? { conversation, content: '' } : {}), sender: { id: 'u1', roles: [] } };
    const command = { permit: ['user(u1)', 'role(user)'] };
    const unknown = explainCommandPermissions(command, { source: input, permissionHost: 'present' });
    expect(unknown.rules.map(item => item.outcome)).toEqual(['match', 'unknown']);
    const empty = explainCommandPermissions(command, { source: input, rolesKnown: true, permissionHost: 'present' });
    expect(empty.rules.map(item => item.outcome)).toEqual(['match', 'match']);
    expect(empty.assumptions.some(item => item.includes('默认 user'))).toBe(true);
    expect(toCommandPermissionSubject(input).scene).toEqual(conversation ? { type: 'group', id: 'g1' } : undefined);
  }
});

it('never represents an empty permit list, absent host or unevaluated platform condition as authorization', () => {
  expect(explainCommandPermissions({}, { source, permissionHost: 'present' }).summary.outcome).toBe('not_evaluated');
  for (const permissionHost of ['missing', 'unverified'] as const) {
    const result = explainCommandPermissions({ permit: ['group()'] }, { source, permissionHost });
    expect(result.rules[0]?.outcome).toBe('match'); expect(result.summary.outcome).toBe('unknown');
  }
  expect(explainCommandPermissions({ permit: ['platform(qq,admin)'] }, { source, permissionHost: 'present' }).summary.outcome).toBe('not_evaluated');
});

it('preserves structured CommandSession roles without interpreting them as canonical missing roles', () => {
  const session = { adapter: 'qq', scene: { id: 'g1', type: 'group' }, sender: { id: 'u1', role: ['admin'] } };
  const result = explainCommandPermissions({ permit: ['role(admin)'] }, { source: session, rolesKnown: true, permissionHost: 'present' });
  expect(result.rules[0]?.outcome).toBe('match'); expect(result.summary.outcome).toBe('match');
});

it('adds authority ids and owners without running command defaults, validation or execution', () => {
  const root = rootPluginId(); const execute = vi.fn(); const factory = vi.fn(() => 'secret'); const validate = vi.fn(() => true);
  const slot = createCapabilitySlot({ owner: root, feature: commandFeatureId, localName: 'demo', source: '/private/source.ts',
    definition: defineCommand({ params: { text: { type: 'string', default: factory, validate } }, permit: ['group()'], execute }) });
  const snapshot: RuntimeSnapshot = { generation: 1, root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/private', children: [] }]]),
    config: new Map(), resources: new Map(), capabilities: new Map([[slot.id, slot]]), projections: new Map() };
  const [command] = new CommandIndex([slot], snapshot).list(); expect(command).toMatchObject({ id: slot.id, owner: root, name: 'demo' });
  expect(explainCommandPermissions(command!, { source, permissionHost: 'present' }).summary.outcome).toBe('match');
  expect(execute).not.toHaveBeenCalled(); expect(factory).not.toHaveBeenCalled(); expect(validate).not.toHaveBeenCalled();
});
