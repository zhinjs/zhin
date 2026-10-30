import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
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
      // Tools may narrow the Skill's scenes, but must not escape its scene ceiling.
      const skillScopes = new Set(definition.scopes ?? []);
      if (skillScopes.size) {
        expect(parsed.scopes?.length ?? 0, toolSource).toBeGreaterThan(0);
      }
      for (const scope of parsed.scopes ?? []) {
        expect(skillScopes.has(scope), `${toolSource}: ${scope}`).toBe(true);
      }
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

function turn(platform: string, scope: 'private' | 'group' | 'channel', botPlatformRole?: string): TurnAccessContext {
  return {
    origin: { kind: 'im', platform, endpoint: 'bot', scope, sceneId: 'scene' },
    principal: { subjectId: 'sender', roles: ['master'] },
    policy: { permissions: ['master'], unattended: false },
    ...(botPlatformRole ? { input: { contextState: { bot: { platformRole: botPlatformRole } } } } : {}),
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
      if (platform === 'qq' && scope === 'channel') {
        const disclosed = capabilities.tools.map(tool => tool.name);
        expect(disclosed).toContain('agent__qq__skill__qq-group-admin__recall_member_message');
        for (const name of ['group_kick', 'set_mute', 'handle_join_request']) {
          expect(disclosed).not.toContain(`agent__qq__skill__qq-group-admin__${name}`);
        }
      }
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
      ...turn('icqq', 'group'), input: { contextState: { bot: { platformRoleError: 'lookup_failed' } } },
    }, 'icqq');
    const roleDependent = [
      'agent__icqq__skill__icqq-group-admin__group_leave',
      'agent__icqq__skill__icqq-group-admin__recall_member_message',
    ];
    expect(admin.tools.filter(tool => tool.currentConversationBotRoles?.length).map(tool => tool.name))
      .toEqual(roleDependent);
    expect(unknown.tools.map(tool => tool.name))
      .toEqual(admin.tools.filter(tool => !roleDependent.includes(tool.name)).map(tool => tool.name));
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
});
