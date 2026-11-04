import { childPluginId, createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { defineAgentTool, ToolIndex, toolFeatureId } from '@zhin.js/tool';
import { CapabilityIngress, type AgentCapabilities } from '../../src/plugin-runtime/capability-ingress.js';
import { expandMcpTools } from '../../src/plugin-runtime/agent-runtime.js';
import { createDeferredCapabilityPlan } from '../../src/plugin-runtime/deferred-capability-plan.js';
import { renderDeferredToolIndex, toolIndexGroup } from '../../src/skill/capability-catalog.js';

/** Actual file-backed descriptors: a different entry path for every tool, two owning plugins. */
function fixture(): RuntimeSnapshot {
  const root = rootPluginId();
  const social = childPluginId(root, 'social');
  const slots = [root, social].flatMap(owner => Array.from({ length: 8 }, (_, index) => createCapabilitySlot({
    owner,
    feature: toolFeatureId,
    localName: `lookup_${index}`,
    source: `/workspace/node_modules/.pnpm/@example+social@1.2.3_peer-hash/node_modules/@example/social/${owner}/tools/lookup_${index}/index.js`,
    definition: defineAgentTool({ description: 'Read a social record.', readOnly: true, execute: () => 'ok' }),
  })));
  const denied = createCapabilitySlot({
    owner: social,
    feature: toolFeatureId,
    localName: 'private_only',
    source: '/private/tools/private_only/index.js',
    definition: defineAgentTool({ description: 'Private only.', scopes: ['private'], execute: () => 'private' }),
  });
  const snapshot: RuntimeSnapshot = {
    generation: 1,
    root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: '@example/root', packageRoot: '/workspace', children: [social] }],
      [social, { id: social, parent: root, instanceKey: 'social', packageName: '@example/social', packageRoot: '/plugins/social', children: [] }],
    ]),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map([...slots, denied].map(slot => [slot.id, slot])),
    projections: new Map(),
  };
  return { ...snapshot, projections: new Map([[toolFeatureId, new ToolIndex([...slots, denied], snapshot)]]) };
}

it('folds real ToolIndex entry paths by their canonical owner after ingress and deferred projection', async () => {
  const snapshot = fixture();
  const capabilities = await new CapabilityIngress().read(snapshot, snapshot.root, () => true, {
    origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'group' },
    principal: { subjectId: 'user', roles: ['user'] },
    policy: { permissions: [], unattended: false },
  });
  expect(capabilities.tools).toHaveLength(16);
  const plan = createDeferredCapabilityPlan({
    capabilities,
    sessionSnapshot: { loadedTools: { social__private_only: 1 }, loadedSkills: [] },
    config: { deferredTools: { alwaysLoadedMode: 'replace', alwaysLoadedTools: ['discover', 'load_tool', 'load_skill'] } },
    persistSnapshot: async () => undefined,
  });
  const deferred = plan.catalog.filter(item => item.deferDefault);
  const index = renderDeferredToolIndex(deferred.map(item => ({
    name: item.name, description: item.brief, group: toolIndexGroup(item),
  })))!;
  expect(index.split('\n').filter(line => line.startsWith('- '))).toEqual([
    '- root: lookup_0, lookup_1, lookup_2, lookup_3, lookup_4, lookup_5, … (8)',
    '- root/social: social__lookup_0, social__lookup_1, social__lookup_2, social__lookup_3, social__lookup_4, social__lookup_5, … (8)',
  ]);
  expect(index).not.toContain('/workspace');
  expect(index).not.toContain('node_modules');
  expect(index).not.toContain('private_only');
  expect(plan.controller.loadedToolNames()).toEqual([]);
  expect(await plan.controller.load('social__private_only')).toBe(false);
  expect(plan.allTools.map(tool => tool.name)).toEqual(plan.capabilities.map(tool => tool.name));
  for (const capability of capabilities.tools) {
    expect(plan.catalog.find(item => item.name === capability.name)).toMatchObject({
      owner: capability.owner,
      fullTool: { source: capability.source },
    });
  }
  // Keep the measured regression about prompt projection, not provider tokenization or pricing.
  const pathGrouped = renderDeferredToolIndex(deferred.map(item => ({
    name: item.name, description: item.brief, group: item.fullTool.source,
  })))!;
  expect(index.length).toBeLessThan(pathGrouped.length / 3);
});

it('keeps two MCP connections of the same owner in distinct server groups', async () => {
  const root = rootPluginId();
  const capabilities: AgentCapabilities = {
    generation: 1, owner: root, tools: [], skills: [], agents: [], promptSections: [],
    mcp: ['first', 'second'].map(name => ({
      owner: root, name, qualifiedName: name, source: `/mcps/${name}/index.js`,
      listTools: async () => [{ name: 'lookup', description: 'Lookup record.' }],
      callTool: async () => { throw new Error('Catalog construction must not execute MCP tools'); },
    })),
  };
  const tools = await expandMcpTools(capabilities, ['first', 'second']);
  const plan = createDeferredCapabilityPlan({
    capabilities: { ...capabilities, tools },
    sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
    config: { deferredTools: { alwaysLoadedMode: 'replace' } },
    persistSnapshot: async () => undefined,
  });
  expect(renderDeferredToolIndex(plan.catalog.filter(item => item.deferDefault).map(item => ({
    name: item.name, description: item.brief, group: toolIndexGroup(item),
  })))?.split('\n').filter(line => line.startsWith('- '))).toEqual([
    '- mcp:first: first__lookup (1)',
    '- mcp:second: second__lookup (1)',
  ]);
  expect(plan.catalog.find(item => item.name === 'first__lookup')).toMatchObject({
    owner: root, mcpServer: 'first', source: 'mcp', fullTool: { source: '/mcps/first/index.js' },
  });
});
