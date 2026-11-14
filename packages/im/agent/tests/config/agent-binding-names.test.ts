/**
 * #1250 sub-agent purposes: `purposes.agents` keys of configured Agent bindings are never
 * used by sub-agents. Names only discovered from `agents/<name>/` files are sub-agents
 * too and must not be counted as bindings, or their own purpose keys would be refused.
 */
import { AgentBindingRegistry } from '../../src/config/agent-binding-registry.js';
import { AIService } from '../../src/service.js';
import type { AgentMeta } from '../../src/discovery/agents.js';
import type { ModelRuntimeServiceOptions } from '../../src/model-runtime/types.js';

const meta = (name: string) => ({ name, displayName: name, version: '1', description: name }) as AgentMeta;

describe('configured Agent binding names', () => {
  it('excludes names only discovered from agent files', () => {
    const registry = new AgentBindingRegistry({ zhin: {}, support: {} }, [meta('researcher'), meta('support')]);
    expect(registry.listAgentNames().sort()).toEqual(['researcher', 'support', 'zhin']);
    expect(registry.listConfiguredBindingNames().sort()).toEqual(['support', 'zhin']);
  });

  it('feeds only configured bindings to the model runtime, after agent discovery too', async () => {
    const service = new AIService({ agents: { support: {} } });
    service.setDiscoveredAgents([meta('researcher')]);
    await service.prepareModelRuntime({ rootId: 'root', hostOwnerId: 'host' } as unknown as ModelRuntimeServiceOptions);
    const options = (service.getModelRuntime() as unknown as { options: ModelRuntimeServiceOptions }).options;
    expect([...options.bindingNames!()].sort()).toEqual(['support', 'zhin']);
    await service.dispose();
  });
});
