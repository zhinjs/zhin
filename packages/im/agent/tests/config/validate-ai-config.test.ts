import { validateModelRuntimeConfig, validateAgentMcpBindings } from '../../src/model-runtime/validation.js';

describe('startup model-authority cutover', () => {
  it.each(['plan', 'providers', 'modelCatalog', 'modelPolicy', 'defaultProvider', 'decisions', 'imageGeneration', 'routes', 'pipeline', 'remoteAgents', 'remote_mesh', 'remoteMesh'])('requires explicit migration for %s, never silently normalizing old selectors', key => {
    expect(validateModelRuntimeConfig({ [key]: {} }, 'host').join(' ')).toContain('migration required');
  });
  it.each(['workroom', 'workrooms'])('fails fast when removed %s key is present (ADR 0048)', key => {
    expect(() => validateModelRuntimeConfig({ [key]: {} }, 'host')).toThrow(
      'Config "ai.workroom" / "ai.workrooms" has been removed in ADR 0048. Migrate multi-bot rooms to "ai.venues" and agent collaboration to "agents/<name>/agent.json" collaboration.',
    );
  });
  it('retains role metadata and legacy nonfunctional priority/match without model selectors', () => {
    expect(validateModelRuntimeConfig({ agents: { zhin: { nickname: 'Bot', priority: 1 }, reviewer: { match: {} } } }, 'host')).toEqual([]);
  });
  it('checks MCP membership against the actual supplied directory, including directory-based resources', () => {
    expect(validateAgentMcpBindings({ agents: { zhin: { mcpServers: ['missing'] } }, mcpServerNames: [] })).toContain('ai.agents.zhin: unknown MCP server "missing"');
    expect(validateAgentMcpBindings({ agents: { zhin: { mcpServers: ['plugin-server'] } }, mcpServerNames: ['plugin-server'] })).toEqual([]);
  });
  it('rejects malformed and duplicate MCP names without resolving credentials or opening a connection', () => {
    expect(validateModelRuntimeConfig({ mcpServers: [{ name: 'same' }, { name: 'same' }] }, 'host')).toContain('ai.mcpServers: duplicate server name');
    expect(validateAgentMcpBindings({ agents: { zhin: { mcpServers: [''] } } })).toContain('ai.agents.zhin: empty mcpServers entry');
    expect(validateAgentMcpBindings({ agents: { zhin: { mcpServers: [' trailing '] } } })).toContain('ai.agents.zhin: MCP server names must not contain surrounding whitespace');
  });
});


it('checks the actually assembled MCP directory before the tool pipeline can connect or call a model', async () => {
  const { prepareTurnTools } = await import('../../src/tool/prepare-turn-tools.js');
  const connect = vi.fn(), collectForTurn = vi.fn();
  const host = { activeBinding: { name: 'reviewer' }, resourceHub: { mcps: { getAll: () => [], connect } }, toolSystem: { collectForTurn } };
  await expect(prepareTurnTools(host as never, { content: 'hello', commMessage: {} as never, externalTools: [], sessionId: 'session', userId: 'user', mcpServerNames: ['missing'] })).rejects.toThrow('unknown MCP server "missing"');
  expect(connect).not.toHaveBeenCalled(); expect(collectForTurn).not.toHaveBeenCalled();
});
