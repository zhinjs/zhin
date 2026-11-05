/**
 * ADR 0048 H2 — builds the {@link CollaborationDirectory} for one turn from
 * agent definitions (agents/<name>/agent.json) and the turn's tool catalog.
 *
 * Duplicate agent names: the first descriptor wins; later ones are ignored.
 * Everything returned is frozen.
 */
import type { AgentDescriptor } from '@zhin.js/agent-feature';
import { ALL, intersectScopes, only, type AgentCeiling, type NameScope } from '@zhin.js/harness';
import { COLLABORATION_TOOL_NAMES, type CollaborationAgent, type CollaborationDirectory } from './contracts.js';

export interface CollaborationDirectoryInput {
  readonly entry: {
    readonly name: string;
    readonly displayName?: string;
    readonly description?: string;
    readonly instructions?: string;
    readonly toolNames: readonly string[];
  };
  readonly agents: readonly AgentDescriptor[];
  /** Tools the current turn actually has; no agent can exceed this. */
  readonly catalogTools: readonly string[];
}

const COLLABORATION_TOOLS: readonly string[] = Object.values(COLLABORATION_TOOL_NAMES);
const EGRESS = Object.freeze({ network: true, hosts: ALL });

export function createCollaborationDirectory(input: CollaborationDirectoryInput): CollaborationDirectory {
  const agents = new Map<string, AgentDescriptor>();
  for (const agent of input.agents) {
    if (agent.name !== input.entry.name && !agents.has(agent.name)) agents.set(agent.name, agent);
  }
  const catalog = only(input.catalogTools);
  const names = [...agents.keys()];

  const resolved = new Map<string, CollaborationAgent>();
  for (const agent of agents.values()) resolved.set(agent.name, agentFor(agent, catalog, names));

  const entryName = input.entry.name;
  const entry: CollaborationAgent = Object.freeze({
    name: entryName,
    displayName: input.entry.displayName ?? entryName,
    description: input.entry.description ?? '',
    instructions: input.entry.instructions ?? '',
    ceiling: Object.freeze({
      agent: entryName,
      tools: only([...input.entry.toolNames, ...(names.length ? COLLABORATION_TOOLS : [])]),
      contacts: only(names),
      maxTrust: 'master',
      egress: EGRESS,
      acceptsFrom: only(['human', ...names]),
    } satisfies AgentCeiling),
  });

  const list = Object.freeze([...resolved.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
  return Object.freeze({
    entry,
    get: (name: string) => (name === entryName ? entry : resolved.get(name)),
    list: () => list,
  });
}

function agentFor(agent: AgentDescriptor, catalog: NameScope, directoryNames: readonly string[]): CollaborationAgent {
  const disallowed = new Set(agent.disallowedTools ?? []);
  // Without a declared list the agent inherits the whole turn catalog.
  const declared = agent.toolNames ?? (catalog.kind === 'only' ? catalog.names : []);
  const tools = intersectScopes(only(declared.filter((tool) => !disallowed.has(tool))), catalog);
  const known = new Set(directoryNames);
  const contacts = only((agent.collaboration?.contacts ?? []).filter((name) => known.has(name)));
  const toolNames = tools.kind === 'only' ? tools.names : [];
  const hasContact = contacts.kind === 'only' && contacts.names.length > 0;
  return Object.freeze({
    name: agent.name,
    displayName: agent.displayName,
    description: agent.description,
    instructions: agent.instructions,
    ceiling: Object.freeze({
      agent: agent.name,
      tools: hasContact ? only([...toolNames, ...COLLABORATION_TOOLS]) : tools,
      contacts,
      maxTrust: 'master',
      egress: EGRESS,
      acceptsFrom: agent.collaboration?.acceptsFrom ? only(agent.collaboration.acceptsFrom) : ALL,
    } satisfies AgentCeiling),
    model: agent.model,
    maxIterations: agent.maxIterations,
  });
}
