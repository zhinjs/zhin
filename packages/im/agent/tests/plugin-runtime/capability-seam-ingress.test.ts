import { describe, expect, it, vi } from 'vitest';
import {
  createCapabilitySlot,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  ToolIndex,
  defineAgentTool,
  toolFeatureId,
} from '@zhin.js/tool';
import { CapabilityIngress } from '../../src/plugin-runtime/capability-ingress.js';
import { SeamIntegration } from '../../src/seam/seam-integration.js';
import { capabilitySeamToken } from '../../src/seam/tokens.js';
import type { ToolService } from '../../src/seam/tool-service.js';
import type { SkillService } from '../../src/seam/skill-service.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';

describe('Capability Seam production ingress', () => {
  it('projects Tool and Skill services into the fixed-generation capability snapshot', async () => {
    const seam = new SeamIntegration();
    seam.registerToolService('global', toolService('remote_lookup', 'never'));
    seam.registerSkillService('global', skillService('remote_research'));
    const snapshot = snapshotWith(seam);

    const capabilities = await new CapabilityIngress().read(snapshot, snapshot.root);

    expect(capabilities.tools.map((tool) => tool.name)).toEqual(['remote_lookup']);
    expect(capabilities.tools[0]).toMatchObject({
      approval: 'never',
      source: 'seam:test:tools',
    });
    expect(capabilities.skills[0]).toMatchObject({
      name: 'remote_research',
      instructions: '# Remote research\nUse the remote lookup tool.',
      source: 'seam:test:skills',
    });
  });

  it('keeps Seam execution behind TurnToolRuntime approval policy', async () => {
    const execute = vi.fn(async () => ({ success: true, output: 'should not run' }));
    const seam = new SeamIntegration();
    seam.registerToolService('global', {
      ...toolService('dangerous_remote', 'always'),
      execute,
    });
    const snapshot = snapshotWith(seam);
    const capabilities = await new CapabilityIngress().read(snapshot, snapshot.root);
    const turn = createTurnIngress({
      intent: { kind: 'new' },
      identity: { rootId: String(snapshot.root), generation: 7, traceId: 'trace', turnId: 'turn' },
      origin: { kind: 'internal', source: 'test' },
      principal: { subjectId: 'user', roles: ['user'] },
      input: { text: 'run it' },
      session: { key: 'test:session' },
      policy: { permissions: ['user'], unattended: true },
      capabilities: { tools: ['dangerous_remote'], skills: [] },
      signal: new AbortController().signal,
      ports: { journal: { append: () => undefined } },
    });

    const outcome = await new TurnToolRuntime(turn, capabilities.tools)
      .execute('dangerous_remote', {}, 'call-1');

    expect(outcome).toMatchObject({ status: 'denied', policy: 'approval' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('retires provider execution with its generation operation', async () => {
    const seam = new SeamIntegration();
    seam.registerToolService('global', toolService('remote_lookup', 'never'));
    const snapshot = snapshotWith(seam);
    let active = true;
    const capabilities = await new CapabilityIngress().read(snapshot, snapshot.root, () => active);
    active = false;

    await expect(capabilities.tools[0]!.execute({}, invocation()))
      .rejects.toThrow('scope has ended');
  });

  it('rejects a Seam Tool that collides with a Feature Tool', async () => {
    const seam = new SeamIntegration();
    seam.registerToolService('global', toolService('lookup', 'never'));
    const base = snapshotWith(seam);
    const slot = createCapabilitySlot({
      owner: base.root,
      feature: toolFeatureId,
      localName: 'lookup',
      source: '/tools/lookup.ts',
      definition: defineAgentTool({
        description: 'Feature lookup',
        execute: () => 'feature',
      }),
    });
    const snapshot: RuntimeSnapshot = {
      ...base,
      capabilities: new Map([[slot.id, slot]]),
      projections: new Map([[toolFeatureId, new ToolIndex([slot], base)]]),
    };

    await expect(new CapabilityIngress().read(snapshot, snapshot.root))
      .rejects.toThrow('Duplicate Agent Tool capability: lookup');
  });
});

function toolService(
  name: string,
  approval: 'never' | 'always',
): ToolService {
  return {
    id: 'test:tools',
    description: 'Test remote tools',
    schema: () => [{
      type: 'function',
      function: {
        name,
        description: 'Remote lookup',
        parameters: { type: 'object', properties: {} },
      },
      approval,
    }],
    execute: async () => ({ success: true, output: 'ok' }),
  };
}

function skillService(name: string): SkillService {
  return {
    id: 'test:skills',
    description: 'Test remote skills',
    catalog: async () => [{ name, description: 'Remote research' }],
    describe: async () => '# Remote research\nUse the remote lookup tool.',
  };
}

function snapshotWith(seam: SeamIntegration): RuntimeSnapshot {
  const root = rootPluginId();
  return {
    generation: 7,
    root,
    tree: new Map([[
      root,
      {
        id: root,
        instanceKey: 'root',
        packageName: '@test/root',
        packageRoot: '/test',
        children: [],
      },
    ]]),
    config: new Map([[root, {}]]),
    resources: new Map([[root, new Map([[capabilitySeamToken.id, seam]])]]),
    capabilities: new Map(),
    projections: new Map(),
  };
}

function invocation() {
  return {
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn',
    sessionKey: 'session',
    origin: { kind: 'internal', source: 'test' },
    principal: { subjectId: 'user', roles: ['user'] },
    policy: {
      permissions: ['user'],
      unattended: false,
      network: { enabled: false },
    },
  } as const;
}
