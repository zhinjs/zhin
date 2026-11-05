/**
 * Sub-agent / deferred-worker switches removed by ADR 0048 H2. Collaboration
 * runs through the harness (`ask` / `delegate` to agent packages), so these
 * fail startup instead of being silently ignored.
 */
const REMOVED_COLLABORATION_AGENT_KEYS = [
  'subagentTurnMode', 'maxParallelSubagents', 'subagentAutoContinue', 'subagentDirectImDelivery',
  'subagentTools', 'subagentTurnWaitMs', 'subagentExecApprovalMode', 'workerExecApprovalMode',
  'workerBaseTools', 'deferredAutoContinue', 'deferredAutoContinueMaxDepth',
] as const;

const COLLABORATION_MIGRATION_HINT = 'sub-agents and deferred workers were replaced by agent collaboration (ADR 0048):'
  + ' delete these keys; declare who an agent may contact in agents/<name>/agent.json `collaboration`.';

/** Startup validation only: model resources now require an explicit runtime import. */
export function validateModelRuntimeConfig(input: unknown, _hostOwnerId: string): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['Invalid AI configuration'];
  const fields = ['plan', 'providers', 'modelCatalog', 'modelPolicy', 'defaultProvider', 'decisions', 'imageGeneration', 'routes', 'pipeline', 'workrooms', 'remoteAgents', 'remote_mesh', 'remoteMesh']
    .filter(key => Object.prototype.hasOwnProperty.call(input, key));
  const raw: Record<string, unknown> = { ...input };
  if (raw.agents && typeof raw.agents === 'object' && !Array.isArray(raw.agents)) {
    for (const [name, entry] of Object.entries(raw.agents)) {
      if (entry && typeof entry === 'object') for (const key of ['provider', 'model', 'preset']) {
        if (Object.prototype.hasOwnProperty.call(entry, key)) fields.push(`agents.${name}.${key}`);
      }
    }
  }
  if (raw.agent && typeof raw.agent === 'object' && !Array.isArray(raw.agent)) {
    if ('providerResilience' in raw.agent && raw.agent.providerResilience && typeof raw.agent.providerResilience === 'object'
      && Object.hasOwn(raw.agent.providerResilience, 'fallback')) fields.push('agent.providerResilience.fallback');
    for (const key of ['chatModel', 'visionModel']) if (Object.hasOwn(raw.agent, key)) fields.push(`agent.${key}`);
    if ('modelHarness' in raw.agent && raw.agent.modelHarness && typeof raw.agent.modelHarness === 'object') {
      for (const key of ['providerPatterns', 'models']) if (Object.hasOwn(raw.agent.modelHarness, key)) fields.push(`agent.modelHarness.${key}`);
    }
  }
  const workroom = raw.workroom;
  if (workroom && typeof workroom === 'object' && 'disclosure' in workroom) {
    const disclosure = workroom.disclosure;
    if (disclosure && typeof disclosure === 'object' && 'modelProviders' in disclosure) fields.push('workroom.disclosure.modelProviders');
  }
  if (raw.trigger && typeof raw.trigger === 'object' && 'ambient' in raw.trigger) {
    const ambient = raw.trigger.ambient;
    if (ambient && typeof ambient === 'object' && 'judge' in ambient) fields.push('trigger.ambient.judge');
  }
  if (raw.multimodal && typeof raw.multimodal === 'object' && 'perception' in raw.multimodal) {
    const perception = raw.multimodal.perception;
    if (perception && typeof perception === 'object') for (const key of ['provider', 'model', 'fallbacks']) {
      if (Object.prototype.hasOwnProperty.call(perception, key)) fields.push(`multimodal.perception.${key}`);
    }
  }
  const errors = fields.length ? [`AI inference migration required: ${fields.join(', ')}`] : [];
  const removed: string[] = [];
  if (raw.agent && typeof raw.agent === 'object' && !Array.isArray(raw.agent)) {
    for (const key of REMOVED_COLLABORATION_AGENT_KEYS) if (Object.hasOwn(raw.agent, key)) removed.push(`ai.agent.${key}`);
  }
  if (raw.agents && typeof raw.agents === 'object' && !Array.isArray(raw.agents)) {
    for (const [name, entry] of Object.entries(raw.agents)) {
      if (entry && typeof entry === 'object' && 'permission' in entry && entry.permission && typeof entry.permission === 'object'
        && Object.hasOwn(entry.permission, 'task')) removed.push(`ai.agents.${name}.permission.task`);
    }
  }
  if (removed.length) errors.push(`${removed.join(', ')} removed; ${COLLABORATION_MIGRATION_HINT}`);
  const servers = Array.isArray(raw.mcpServers) ? raw.mcpServers : [];
  const names = servers.flatMap(server => server && typeof server === 'object' && 'name' in server && typeof server.name === 'string' ? [server.name] : []);
  if (new Set(names).size !== names.length) errors.push('ai.mcpServers: duplicate server name');
  errors.push(...validateAgentMcpBindings({ agents: raw.agents }));
  return errors;
}


/** Pure validation against the caller's actual MCP directory, never a model registry. */
export function validateAgentMcpBindings(input: Readonly<{ agents: unknown; mcpServerNames?: readonly string[] }>): string[] {
  const errors: string[] = [], known = input.mcpServerNames ? new Set(input.mcpServerNames) : undefined;
  if (!input.agents || typeof input.agents !== 'object' || Array.isArray(input.agents)) return errors;
  for (const [name, value] of Object.entries(input.agents)) {
    if (!value || typeof value !== 'object' || !('mcpServers' in value) || value.mcpServers == null) continue;
    if (!Array.isArray(value.mcpServers)) { errors.push(`ai.agents.${name}: invalid mcpServers`); continue; }
    for (const server of value.mcpServers) {
      if (typeof server !== 'string' || !server.trim()) errors.push(`ai.agents.${name}: empty mcpServers entry`);
      else if (server !== server.trim()) errors.push(`ai.agents.${name}: MCP server names must not contain surrounding whitespace`);
      else if (known && !known.has(server)) errors.push(`ai.agents.${name}: unknown MCP server "${server}"`);
    }
  }
  return errors;
}
