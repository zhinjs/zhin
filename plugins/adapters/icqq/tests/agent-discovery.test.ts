import { fileURLToPath } from 'node:url';
import { FeatureDiscovery } from '@zhin.js/feature-kit';
import toolFeature, { ToolIndex, toolFeatureId } from '@zhin.js/tool';
import skillFeature, { SkillIndex, skillFeatureId } from '@zhin.js/skill';
import { PermissionHost, permissionHostToken } from '@zhin.js/permission';
import { createSnapshotView, rootPluginId } from 'zhin.js';
import { NodeDiscoveryHost } from '../../../../packages/im/runtime/src/node-discovery-host.js';
import { CapabilityIngress } from '../../../../packages/im/agent/src/plugin-runtime/capability-ingress.js';
import { createDeferredCapabilityPlan } from '../../../../packages/im/agent/src/plugin-runtime/deferred-capability-plan.js';

it('discovers real ICQQ skills, gates member tools by requester, and loads own recall on demand', async () => {
  const root = rootPluginId();
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  const host = new NodeDiscoveryHost({ load: (source: string) => import(source) } as never);
  const discovery = new FeatureDiscovery(host);
  const tools = await discovery.discover(toolFeature, [{ owner: root, packageRoot }]);
  const skills = await discovery.discover(skillFeature, [{ owner: root, packageRoot }]);
  const state = {
    root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@zhin.js/adapter-icqq', packageRoot, children: [] }]]),
    config: new Map([[root, {}]]), resources: new Map([[root, new Map([[permissionHostToken.id, new PermissionHost()]])]]),
    capabilities: new Map([...tools, ...skills].map(slot => [slot.id, slot])), projections: new Map(),
  };
  const initial = createSnapshotView(1, state);
  const snapshot = createSnapshotView(1, { ...state, projections: new Map([
    [toolFeatureId, new ToolIndex(tools, initial) as unknown], [skillFeatureId, new SkillIndex(skills, initial)],
  ]) });
  const ingress = new CapabilityIngress();
  const turn = {
    origin: { kind: 'im' as const, platform: 'icqq', endpoint: '7', scope: 'group' as const, sceneId: '100' },
    principal: { subjectId: '2', roles: [] as string[] }, policy: { permissions: [], unattended: false, network: { enabled: false } },
    input: { contextState: { bot: { platformRole: undefined as string | undefined } } },
  };
  const unselected = await ingress.read(snapshot, root, () => true, turn);
  expect(unselected.skills).toHaveLength(0);
  expect(unselected.tools.every(tool => tool.hidden)).toBe(true);
  const member = await ingress.read(snapshot, root, () => true, turn, 'icqq');
  const own = member.tools.find(tool => tool.name.endsWith('__recall_own_message'))!;
  expect(own).toMatchObject({ requiresApproval: 'never', hidden: true, placement: { kind: 'agent-skill', agent: 'icqq', skill: 'icqq-messages' } });
  expect(member.tools.some(tool => tool.name.endsWith('__recall_member_message') || tool.name.endsWith('__group_leave'))).toBe(false);
  // These existing operations have no sender permission declaration. Their target
  // group and approval checks remain at execution; current-group role must not narrow them.
  for (const name of ['set_mute', 'set_title', 'group_invite']) {
    expect(member.tools.find(tool => tool.name.endsWith(`__${name}`)))
      .toMatchObject({ requiresApproval: 'always', permissions: undefined, currentConversationBotRoles: undefined });
  }
  const plan = createDeferredCapabilityPlan({ capabilities: member, platform: 'icqq',
    sessionSnapshot: { loadedTools: {}, loadedSkills: [] }, config: { deferredTools: {} }, persistSnapshot: async () => undefined });
  expect(plan.resolvedTools.map(tool => tool.name)).not.toContain(own.name);
  const skill = member.skills.find(skill => skill.name === 'icqq-messages')!;
  await plan.capabilities.find(tool => tool.name === 'load_skill')!.execute({ name: skill.qualifiedName }, { signal: new AbortController().signal } as never);
  expect(plan.controller.loadedToolNames()).toContain(own.name);

  turn.principal.roles = ['admin'];
  const unknown = await ingress.read(snapshot, root, () => true, turn, 'icqq');
  expect(unknown.tools.some(tool => tool.name.endsWith('__recall_member_message'))).toBe(false);
  expect(unknown.tools.some(tool => tool.name.endsWith('__recall_own_message'))).toBe(true);
  turn.input.contextState.bot.platformRole = 'admin';
  const admin = await ingress.read(snapshot, root, () => true, turn, 'icqq');
  expect(admin.tools.some(tool => tool.name.endsWith('__recall_member_message'))).toBe(true);
  expect(admin.tools.some(tool => tool.name.endsWith('__group_leave'))).toBe(false);
  turn.principal.roles = ['master'];
  const master = await ingress.read(snapshot, root, () => true, turn, 'icqq');
  expect(master.tools.find(tool => tool.name.endsWith('__group_leave'))).toMatchObject({ requiresApproval: 'human', risk: 'dangerous' });
  turn.input.contextState.bot.platformRole = 'owner';
  const ownerBot = await ingress.read(snapshot, root, () => true, turn, 'icqq');
  expect(ownerBot.tools.some(tool => tool.name.endsWith('__group_leave'))).toBe(false);
  expect(ownerBot.tools.some(tool => tool.name.endsWith('__recall_member_message'))).toBe(true);
  turn.input.contextState.bot.platformRole = 'member';
  const memberBot = await ingress.read(snapshot, root, () => true, turn, 'icqq');
  expect(memberBot.tools.some(tool => tool.name.endsWith('__recall_member_message'))).toBe(false);
  expect(memberBot.tools.some(tool => tool.name.endsWith('__group_leave'))).toBe(true);
  expect(memberBot.tools.some(tool => tool.name.endsWith('__recall_own_message'))).toBe(true);
  expect(memberBot.tools.some(tool => tool.name.endsWith('__group_kick'))).toBe(true);
});
