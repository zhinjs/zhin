import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveTurnCapabilities, type AdapterCapabilityProfile } from '@zhin.js/adapter';
import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { parseSkillMarkdown, SkillIndex, skillFeatureId } from '@zhin.js/skill';
import { ToolIndex, toolFeatureId, parseAgentToolDefinition } from '@zhin.js/tool';
import { permissionHostToken } from '@zhin.js/permission';
import { CapabilityIngress } from '../../src/plugin-runtime/capability-ingress.js';
import { createDeferredCapabilityPlan } from '../../src/plugin-runtime/deferred-capability-plan.js';
import type { TurnAccessContext } from '../../src/turn/turn-ingress.js';

const adapters = fileURLToPath(new URL('../../../../../plugins/adapters/', import.meta.url));
const platforms = ['icqq', 'napcat', 'dingtalk', 'lark', 'line', 'discord', 'qq', 'slack', 'kook', 'onebot11', 'telegram'];

/** Load the shipped definitions, without starting any endpoint or executing a platform tool. */
async function loadAdapter(platform: string): Promise<RuntimeSnapshot> {
  const owner = rootPluginId();
  const directory = join(adapters, platform, 'agents', platform, 'skills');
  const skillSlots = [];
  const toolSlots = [];
  for (const name of readdirSync(directory)) {
    const source = join(directory, name, 'SKILL.md');
    const localName = `agent/${platform}/${name}`;
    const tools = readdirSync(join(directory, name, 'tools'));
    const definition = parseSkillMarkdown({
      markdown: readFileSync(source, 'utf8'),
      privateToolNames: tools.map(tool => `agent__${platform}__skill__${name}__${tool}`),
    }, { owner, feature: skillFeatureId, localName, source });
    skillSlots.push(createCapabilitySlot({ owner, feature: skillFeatureId, localName, source, definition }));
    for (const tool of tools) {
      const toolSource = join(directory, name, 'tools', tool, 'index.ts');
      const context = { owner, feature: toolFeatureId, localName: `agent/${platform}/skill/${name}/${tool}`, source: toolSource };
      const loaded = await import(pathToFileURL(toolSource).href);
      const parsed = parseAgentToolDefinition(loaded.default, context);
      // A private tool must not outlive its Skill's scene ceiling, nor silently mix scenes back in.
      expect(parsed.scopes ?? [], toolSource).toEqual(definition.scopes ?? []);
      toolSlots.push(createCapabilitySlot({ ...context, definition: parsed }));
    }
  }
  const slots = [...skillSlots, ...toolSlots];
  const snapshot: RuntimeSnapshot = {
    generation: 1, root: owner,
    tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: '@test/root', packageRoot: adapters, children: [] }]]),
    config: new Map([[owner, {}]]),
    // Permissions are tested separately. Grant here to isolate scene disclosure from role filtering.
    resources: new Map([[owner, new Map([[permissionHostToken.id, { check: () => true, checkAll: () => true }]])]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])),
    projections: new Map(),
  };
  return { ...snapshot, projections: new Map([
    [toolFeatureId, new ToolIndex(toolSlots, snapshot)],
    [skillFeatureId, new SkillIndex(skillSlots, snapshot)],
  ]) };
}

/**
 * A declared fixture profile shaped like a QQ group adapter (ADR 0044): moderation actions need a Bot admin,
 * and the adapter narrows `recall.others` the same way. Real adapters declare their own.
 */
const groupModerationProfile: AdapterCapabilityProfile = {
  default: { delivery: { send: true } },
  group: {
    actions: {
      mute: { scopes: ['group'], requiresRole: 'admin' },
      kick: { scopes: ['group'], requiresRole: 'admin' },
      essence: { scopes: ['group'], requiresRole: 'admin' },
      announce: { scopes: ['group'], requiresRole: 'admin' },
      setTitle: { scopes: ['group'], requiresRole: 'admin' },
      recall: { scopes: ['group'], params: { others: true } },
    },
  },
};

function platformCapabilities(scope: 'private' | 'group' | 'channel', botPlatformRole?: string) {
  return resolveTurnCapabilities({
    profile: groupModerationProfile,
    conversation: { endpoint: { id: 'bot', adapter: 'icqq' }, kind: scope, id: 'scene' },
    facts: botPlatformRole ? { bot: { platformRole: botPlatformRole } } : {},
    narrow: ({ facts }) => facts.bot?.platformRole === 'admin' || facts.bot?.platformRole === 'owner'
      ? undefined
      : { actions: { recall: { params: { others: false } } } },
  });
}

/** The tools whose declaration says a platform capability is required (the icqq group-admin set). */
const capabilityGated = [
  'agent__icqq__skill__icqq-group-admin__announce',
  'agent__icqq__skill__icqq-group-admin__essence',
  'agent__icqq__skill__icqq-group-admin__group_kick',
  'agent__icqq__skill__icqq-group-admin__recall_member_message',
  'agent__icqq__skill__icqq-group-admin__set_mute',
  'agent__icqq__skill__icqq-group-admin__set_title',
];

function turn(platform: string, scope: 'private' | 'group' | 'channel', botPlatformRole?: string): TurnAccessContext {
  const caps = platform === 'icqq' ? platformCapabilities(scope, botPlatformRole) : undefined;
  return {
    origin: { kind: 'im', platform, endpoint: 'bot', scope, sceneId: 'scene' },
    principal: { subjectId: 'sender', roles: ['master'] },
    policy: { permissions: ['master'], unattended: false },
    ...(botPlatformRole || caps ? { input: {
      ...(botPlatformRole ? { contextState: { bot: { platformRole: botPlatformRole } } } : {}),
      ...(caps ? { platformCapabilities: caps } : {}),
    } } : {}),
  };
}

describe('adapter-owned scene disclosure (#949)', () => {
  it.each(platforms)('%s filters shipped Skill catalogs, private tools and previously loaded instructions on every turn', async platform => {
    const snapshot = await loadAdapter(platform);
    const ingress = new CapabilityIngress();
    const index = snapshot.projections.get(skillFeatureId) as SkillIndex;
    const tools = snapshot.projections.get(toolFeatureId) as ToolIndex;
    if (platform === 'icqq') {
      expect(index.list().find(skill => skill.name === 'icqq-directory')?.instructions)
        .toContain('目录信息只向群主、管理员、master 或 trusted 披露');
    }
    expect(index.list().some(skill => skill.scopes?.length)).toBe(true);
    for (const scope of ['private', 'group', 'channel'] as const) {
      // ICQQ admin is eligible for both current-group recall and safe leave;
      // keep the full scene-disclosure assertion independent of missing role data.
      const botRole = platform === 'icqq' && scope === 'group' ? 'admin' : undefined;
      const capabilities = await ingress.read(snapshot, snapshot.root, () => true, turn(platform, scope, botRole), platform);
      const expected = index.list().filter(skill => !skill.scopes || skill.scopes.includes(scope));
      expect(capabilities.skills.map(skill => skill.qualifiedName)).toEqual(expected.map(skill => skill.qualifiedName));
      expect(capabilities.tools.map(tool => tool.name)).toEqual(tools.list()
        .filter(tool => !tool.scopes || tool.scopes.includes(scope)).map(tool => tool.qualifiedName));
      const plan = createDeferredCapabilityPlan({
        capabilities, platform, config: { deferredTools: {} },
        // Simulate a persisted session that had loaded every category before this turn.
        sessionSnapshot: {
          loadedSkills: index.list().map(skill => skill.qualifiedName),
          loadedTools: Object.fromEntries(tools.list().map(tool => [tool.qualifiedName, 1])),
        },
        persistSnapshot: async () => undefined,
      });
      for (const hidden of index.list().filter(skill => skill.scopes && !skill.scopes.includes(scope))) {
        expect(plan.controller.loadedSkillInstructions()).not.toContain(hidden.instructions);
      }
      for (const hidden of tools.list().filter(tool => tool.scopes && !tool.scopes.includes(scope))) {
        expect(plan.controller.loadedToolNames()).not.toContain(hidden.qualifiedName);
        expect(await plan.controller.load(hidden.qualifiedName)).toBe(false);
        expect(plan.allTools.some(tool => tool.name === hidden.qualifiedName)).toBe(false);
      }
    }
    expect((await ingress.read(snapshot, snapshot.root, () => true, turn('unrelated', 'group'), platform)).skills).toEqual([]);
  });

  it('hides only role-dependent ICQQ group tools when Bot role lookup fails, including prior session loads', async () => {
    const snapshot = await loadAdapter('icqq');
    const ingress = new CapabilityIngress();
    const admin = await ingress.read(snapshot, snapshot.root, () => true, turn('icqq', 'group', 'admin'), 'icqq');
    const unknown = await ingress.read(snapshot, snapshot.root, () => true, {
      ...turn('icqq', 'group'),
      input: { contextState: { bot: { platformRoleError: 'lookup_failed' } }, platformCapabilities: platformCapabilities('group') },
    }, 'icqq');
    const roleDependent = [
      'agent__icqq__skill__icqq-group-admin__group_leave',
      'agent__icqq__skill__icqq-group-admin__recall_member_message',
    ];
    expect(admin.tools.filter(tool => tool.currentConversationBotRoles?.length).map(tool => tool.name))
      .toEqual(roleDependent);
    // An unknown Bot role fails closed for every capability that needs one, too.
    expect(unknown.tools.map(tool => tool.name))
      .toEqual(admin.tools.filter(tool => !roleDependent.includes(tool.name) && !capabilityGated.includes(tool.name)).map(tool => tool.name));
    expect(unknown.skills.map(skill => skill.qualifiedName)).toEqual(admin.skills.map(skill => skill.qualifiedName));
    expect(unknown.tools.some(tool => tool.name.endsWith('__recall_own_message'))).toBe(true);
    const plan = createDeferredCapabilityPlan({
      capabilities: unknown, platform: 'icqq', config: { deferredTools: {} },
      sessionSnapshot: {
        loadedSkills: admin.skills.map(skill => skill.qualifiedName),
        loadedTools: Object.fromEntries(admin.tools.map(tool => [tool.name, 1])),
      },
      persistSnapshot: async () => undefined,
    });
    for (const name of roleDependent) {
      expect(plan.controller.loadedToolNames()).not.toContain(name);
      expect(plan.allTools.some(tool => tool.name === name)).toBe(false);
      expect(await plan.controller.load(name)).toBe(false);
    }
  });

  it('requiresCapabilities: the Bot losing admin hides mute/kick/essence/announce/title/recall-others tools, restoring shows them', async () => {
    const snapshot = await loadAdapter('icqq');
    const ingress = new CapabilityIngress();
    const names = async (role?: string) => (await ingress.read(
      snapshot, snapshot.root, () => true, turn('icqq', 'group', role), 'icqq',
    )).tools.map(tool => tool.name);

    const asAdmin = await names('admin');
    expect(asAdmin).toEqual(expect.arrayContaining(capabilityGated));

    const asMember = await names('member');
    for (const gated of capabilityGated) expect(asMember).not.toContain(gated);
    // ungated tools stay: own-message recall, leaving the group (its own role gate admits a member), info lookups
    expect(asMember).toContain('agent__icqq__skill__icqq-messages__recall_own_message');
    expect(asMember).toContain('agent__icqq__skill__icqq-group-admin__group_leave');

    expect(await names('admin')).toEqual(asAdmin);
    expect(await names('owner')).toEqual(expect.arrayContaining(capabilityGated));
  });

  it('requiresCapabilities fails closed without per-turn platform capabilities (non-IM or unresolved)', async () => {
    const snapshot = await loadAdapter('icqq');
    const ingress = new CapabilityIngress();
    const bare = await ingress.read(snapshot, snapshot.root, () => true, {
      ...turn('icqq', 'group'), input: { contextState: { bot: { platformRole: 'admin' } } },
    }, 'icqq');
    for (const gated of capabilityGated) expect(bare.tools.map(tool => tool.name)).not.toContain(gated);
  });
});
