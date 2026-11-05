/**
 * ADR 0048 H2 — builds the {@link CollaborationDirectory} for one turn from
 * agent definitions (agents/<name>/agent.json) and the turn's tool catalog.
 *
 * Duplicate agent names: the first descriptor wins; later ones are ignored.
 * Everything returned is frozen.
 */
import type { AgentCollaborationBudget, AgentDescriptor } from '@zhin.js/agent-feature';
import {
  ALL,
  agentOf,
  intersectScopes,
  only,
  type AgentCeiling,
  type BudgetAmounts,
  type NameScope,
} from '@zhin.js/harness';
import { COLLABORATION_TOOL_NAMES, type CollaborationAgent, type CollaborationDirectory } from './contracts.js';

export interface CollaborationDirectoryInput {
  readonly entry: {
    readonly name: string;
    readonly displayName?: string;
    readonly description?: string;
    readonly instructions?: string;
    readonly toolNames: readonly string[];
    /** When true, the entry agent may also delegate to an isolated ephemeral worker of itself. */
    readonly allowSelfDelegation?: boolean;
  };
  readonly agents: readonly AgentDescriptor[];
  /** Tools the current turn actually has; no agent can exceed this. */
  readonly catalogTools: readonly string[];
}

export type BuildCollaborationDirectoryInput = CollaborationDirectoryInput;

const COLLABORATION_TOOLS: readonly string[] = Object.values(COLLABORATION_TOOL_NAMES);
const EGRESS = Object.freeze({ network: true, hosts: ALL });

/** Default root budget for an engagement (matches HostMailbox DEFAULT_ENGAGEMENT_BUDGET). */
export function defaultRootBudget(): BudgetAmounts {
  return Object.freeze({
    modelCalls: 60,
    tokens: 400_000,
    wallMs: 10 * 60 * 1000,
    sideEffects: 30,
  });
}

function normalizeDefaultBudget(raw?: AgentCollaborationBudget): Partial<BudgetAmounts> | undefined {
  if (!raw) return undefined;
  const out: { modelCalls?: number; tokens?: number; wallMs?: number; sideEffects?: number } = {};
  if (typeof raw.modelCalls === 'number' && Number.isInteger(raw.modelCalls) && raw.modelCalls >= 1) {
    out.modelCalls = raw.modelCalls;
  }
  if (typeof raw.tokens === 'number' && Number.isInteger(raw.tokens) && raw.tokens >= 1) {
    out.tokens = raw.tokens;
  }
  if (typeof raw.wallMs === 'number' && Number.isInteger(raw.wallMs) && raw.wallMs >= 1) {
    out.wallMs = raw.wallMs;
  }
  if (typeof raw.sideEffects === 'number' && Number.isInteger(raw.sideEffects) && raw.sideEffects >= 1) {
    out.sideEffects = raw.sideEffects;
  }
  return Object.keys(out).length > 0 ? Object.freeze(out) : undefined;
}

export function createCollaborationDirectory(input: CollaborationDirectoryInput): CollaborationDirectory {
  const agents = new Map<string, AgentDescriptor>();
  let entryDescriptor: AgentDescriptor | undefined;
  for (const agent of input.agents) {
    if (agent.name === input.entry.name) {
      entryDescriptor ??= agent;
    } else if (!agents.has(agent.name)) {
      agents.set(agent.name, agent);
    }
  }
  const catalog = only(input.catalogTools);
  const names = [...agents.keys()];

  const resolved = new Map<string, CollaborationAgent>();
  for (const agent of agents.values()) resolved.set(agent.name, agentFor(agent, catalog, names, input.entry.name));

  const entryName = input.entry.name;
  const entryDisallowed = new Set(entryDescriptor?.disallowedTools ?? []);
  const entryDeclared = entryDescriptor?.toolNames ?? input.entry.toolNames;
  const entryToolsScope = intersectScopes(
    only(entryDeclared.filter((tool) => !entryDisallowed.has(tool))),
    only(input.entry.toolNames),
  );
  const entryToolNames = entryToolsScope.kind === 'only' ? entryToolsScope.names : [];
  const entrySelfAllowed = Boolean(
    input.entry.allowSelfDelegation
    || entryDescriptor?.collaboration?.contacts?.includes('self')
    || entryDescriptor?.collaboration?.contacts?.includes(entryName),
  );
  const knownContacts = new Set([...names, entryName, 'self']);
  const baseEntryContacts = entryDescriptor?.collaboration?.contacts !== undefined
    ? entryDescriptor.collaboration.contacts.filter((name) => knownContacts.has(name))
    : names;
  const entryContacts = entrySelfAllowed
    ? [...new Set([...baseEntryContacts, entryName, 'self'])]
    : baseEntryContacts;
  const entryAccepts = entryDescriptor?.collaboration?.acceptsFrom
    ? entryDescriptor.collaboration.acceptsFrom
    : entrySelfAllowed
      ? ['human', ...names, entryName, 'self']
      : ['human', ...names];
  const entryDefaultBudget = normalizeDefaultBudget(entryDescriptor?.collaboration?.budget);
  const entryHasCollabTools = names.length > 0 || entrySelfAllowed;
  const entry: CollaborationAgent = Object.freeze({
    name: entryName,
    displayName: input.entry.displayName ?? entryDescriptor?.displayName ?? entryName,
    description: input.entry.description ?? entryDescriptor?.description ?? '',
    instructions: input.entry.instructions ?? entryDescriptor?.instructions ?? '',
    ceiling: Object.freeze({
      agent: entryName,
      tools: only([...entryToolNames, ...(entryHasCollabTools ? COLLABORATION_TOOLS : [])]),
      contacts: only(entryContacts),
      maxTrust: 'master',
      egress: EGRESS,
      acceptsFrom: only(entryAccepts),
      ...(entryDefaultBudget ? { defaultBudget: entryDefaultBudget } : {}),
    } satisfies AgentCeiling),
    ...(entryDescriptor?.model ? { model: entryDescriptor.model } : {}),
    ...(entryDescriptor?.maxIterations !== undefined ? { maxIterations: entryDescriptor.maxIterations } : {}),
    ...(entryDefaultBudget ? { defaultBudget: entryDefaultBudget } : {}),
  });

  const selfWorker: CollaborationAgent = Object.freeze({
    name: 'self',
    displayName: entry.displayName,
    description: entry.description || 'Isolated ephemeral worker of the current agent',
    instructions: entry.instructions,
    ceiling: Object.freeze({
      agent: 'self',
      tools: only(entryToolNames),
      contacts: only([]),
      maxTrust: 'master',
      egress: EGRESS,
      acceptsFrom: ALL,
      ...(entryDefaultBudget ? { defaultBudget: entryDefaultBudget } : {}),
    } satisfies AgentCeiling),
    ...(entry.model ? { model: entry.model } : {}),
    ...(entry.maxIterations !== undefined ? { maxIterations: entry.maxIterations } : {}),
    ...(entryDefaultBudget ? { defaultBudget: entryDefaultBudget } : {}),
  });

  const list = Object.freeze([...resolved.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
  return Object.freeze({
    entry,
    get: (name: string) => {
      const base = agentOf(name);
      if (base === entryName) return entry;
      if (base === 'self') return resolved.get('self') ?? selfWorker;
      return resolved.get(base);
    },
    list: () => list,
  });
}

export const buildCollaborationDirectory = createCollaborationDirectory;

function agentFor(
  agent: AgentDescriptor,
  catalog: NameScope,
  directoryNames: readonly string[],
  entryName: string,
): CollaborationAgent {
  const disallowed = new Set(agent.disallowedTools ?? []);
  // Without a declared list the agent inherits the whole turn catalog.
  const declared = agent.toolNames ?? (catalog.kind === 'only' ? catalog.names : []);
  const tools = intersectScopes(only(declared.filter((tool) => !disallowed.has(tool))), catalog);
  const known = new Set([...directoryNames, entryName, 'self']);
  const rawContacts = (agent.collaboration?.contacts ?? []).filter((name) => known.has(name));
  const contacts = only(
    rawContacts.includes('self') && !rawContacts.includes(agent.name)
      ? [...rawContacts, agent.name]
      : rawContacts,
  );
  const toolNames = tools.kind === 'only' ? tools.names : [];
  const hasContact = contacts.kind === 'only' && contacts.names.length > 0;
  const defaultBudget = normalizeDefaultBudget(agent.collaboration?.budget);
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
      ...(defaultBudget ? { defaultBudget } : {}),
    } satisfies AgentCeiling),
    model: agent.model,
    maxIterations: agent.maxIterations,
    ...(defaultBudget ? { defaultBudget } : {}),
  });
}
