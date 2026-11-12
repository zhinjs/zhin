import type { CapabilityOperationFactory } from '@zhin.js/feature-kit';
import { adapterFeatureId, isAdapterIndex } from '@zhin.js/core';
import { isFeatureOwnerEnabled, resolveEndpointFeatureKey, type CapabilityId, type FeatureId, type PluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { permissionHostToken, type PermissionHost } from '@zhin.js/permission';
import { turnPermissionSubject, type TurnAccessContext } from '../turn/turn-ingress.js';
import {
  type AgentIndex,
  isAgentIndex,
  agentFeatureId,
  type AgentDescriptor,
} from '@zhin.js/agent-feature';
import {
  type McpIndex,
  isMcpIndex,
  mcpFeatureId,
  type McpDescriptor,
  type McpToolDescriptor,
} from '@zhin.js/mcp-feature';
import {
  type SkillIndex,
  isSkillIndex,
  skillFeatureId,
  type SkillDescriptor,
} from '@zhin.js/skill';
import {
  type ToolIndex,
  isToolIndex,
  toolFeatureId,
  type ToolDescriptor,
  type ToolInvocationContext,
} from '@zhin.js/tool';
import {
  isPromptSectionIndex,
  promptSectionFeatureId,
  type PromptSectionDescriptor,
  type PromptProfile,
} from '@zhin.js/prompt-section';
import { promptSegmentToken, promptSegmentsOf } from '../prompt/tokens.js';
import type { PromptSegment } from '../prompt/segments/types.js';
import { isTextSegmentKind } from '../prompt/segments/registry.js';
import { labelThirdPartyGuidance } from '../prompt/third-party-guidance.js';
import { capabilitySeamToken } from '../seam/tokens.js';
import type { SeamIntegration } from '../seam/seam-integration.js';
import { localImageAssetsToken, type LocalImageAssetStore } from '../media/local-image-assets.js';
import { captureToolImages } from '../media/tool-image-results.js';
import { resolveSkillTools } from './skill-tool-resolution.js';

export interface ToolCapability extends ToolDescriptor {
  /** MCP connection identity for catalog grouping; ownership still governs execution. */
  readonly mcpServer?: string;
  execute<TInput = unknown, TResult = unknown>(
    input: TInput,
    invocation: ToolInvocationContext,
  ): Promise<TResult>;
}

export interface McpCapability extends McpDescriptor {
  listTools(): Promise<readonly McpToolDescriptor[]>;
  callTool<TResult = unknown>(tool: string, input: unknown, invocation?: ToolInvocationContext): Promise<TResult>;
}

export interface AgentCapabilities {
  readonly generation: number;
  readonly owner: PluginId;
  readonly tools: readonly ToolCapability[];
  readonly skills: readonly SkillDescriptor[];
  readonly agents: readonly AgentDescriptor[];
  readonly mcp: readonly McpCapability[];
  readonly promptSections: readonly PromptSectionDescriptor[];
  /** ADR 0041 segments provided on plugin Scopes via `promptSegmentToken`, of this generation. */
  readonly promptSegments?: readonly PromptSegment[];
  /** ADR 0044 §4: the turn's adapter plugin is not the agent owner, so its prompt text is external content. */
  readonly platformGuidanceExternal?: boolean;
}

export interface CapabilityIngressInput {
  readonly snapshot: RuntimeSnapshot;
  readonly owner: PluginId;
  readonly isActive?: () => boolean;
  readonly turn?: TurnAccessContext;
  readonly selectedAgent?: string;
  readonly operation?: CapabilityOperationFactory;
}
export class CapabilityIngress {
  async read(input: CapabilityIngressInput): Promise<AgentCapabilities> {
    const { snapshot, owner, isActive = () => true, turn, selectedAgent, operation } = input;
    if (!snapshot.tree.has(owner)) throw new Error(`Unknown Agent capability owner: ${owner}`);
    const tools = projection(snapshot, toolFeatureId, isToolIndex);
    const mcp = projection(snapshot, mcpFeatureId, isMcpIndex);
    const promptProjection = snapshot.projections.get(promptSectionFeatureId);
    const promptSections = isPromptSectionIndex(promptProjection) ? promptProjection : undefined;
    const promptProfile: PromptProfile = turn?.origin.kind === 'schedule' ? 'schedule' : 'interactive';
    // ADR 0050 §6: Plugins switched off for this conversation's endpoint disclose no tools or skills.
    const enabled = featureGate(snapshot, turn);
    const localAssets = resolveLocalAssets(snapshot);
    const featureTools = (await bindTools({ index: tools, owner, isActive, turn,
      host: resolvePermissionHost(snapshot), selectedAgent, operationSnapshot: snapshot, operation, localAssets }))
      .filter(tool => enabled(tool.owner));
    const featureSkills = (await bindSkills(
      projection(snapshot, skillFeatureId, isSkillIndex),
      turn,
      resolvePermissionHost(snapshot),
      selectedAgent,
    )).filter(skill => enabled(skill.owner));
    const seam = resolveSeamIntegration(snapshot);
    const seamTools = seam
      ? await bindSeamTools(seam, owner, isActive, turn, resolvePermissionHost(snapshot), localAssets)
      : [];
    const seamSkills = seam
      ? await bindSeamSkills(seam, owner, turn, resolvePermissionHost(snapshot))
      : [];
    assertDistinctCapabilities('Tool', [...featureTools, ...seamTools]);
    assertDistinctCapabilities(
      'Skill',
      [...featureSkills, ...seamSkills].map((skill) => ({ name: skill.qualifiedName })),
    );
    const featureAgents = await bindAgents(
      projection(snapshot, agentFeatureId, isAgentIndex),
      owner,
      turn,
      resolvePermissionHost(snapshot),
    );
    const availableTools = Object.freeze([...featureTools, ...seamTools]);
    const availableSkills = Object.freeze([...featureSkills, ...seamSkills]
      .filter(skill => !skill.toolNames?.length || resolveSkillTools(skill, availableTools).length > 0));
    return Object.freeze({
      generation: snapshot.generation,
      owner,
      tools: availableTools,
      skills: availableSkills,
      agents: featureAgents,
      mcp: bindMcp(mcp, owner, isActive, localAssets),
      promptSegments: collectPromptSegments(snapshot, owner),
      platformGuidanceExternal: adapterIsExternal(snapshot, owner, turn),
      promptSections: Object.freeze([...(promptSections?.visible(owner, promptProfile) ?? [])]
        .filter((section) => !section.platforms
          || (turn?.origin.kind === 'im' && section.platforms.includes(turn.origin.platform)))
        .filter((section) => !section.scopes
          || (turn?.origin.kind === 'im' && section.scopes.includes(turn.origin.scope)))),
    });
  }
}

/**
 * ADR 0044 trust decision (single place, easy to revert): an adapter package published under the
 * `@zhin.js/` scope is an official, trusted adapter; its custom `profile.prompt.text` is not labelled
 * `external_content`. Every other adapter package keeps the label.
 */
const TRUSTED_ADAPTER_SCOPE = '@zhin.js/';
export function isTrustedOfficialAdapterPackage(packageName: string | undefined): boolean {
  return typeof packageName === 'string' && packageName.startsWith(TRUSTED_ADAPTER_SCOPE);
}

/** Owner predicate for the turn's endpoint; non-IM turns and unknown endpoints see every owner. */
export function featureGate(snapshot: RuntimeSnapshot, turn?: TurnAccessContext): (owner: PluginId) => boolean {
  const endpoint = turn?.origin.kind === 'im' ? turn.origin.conversation?.endpoint.id : undefined;
  const key = endpoint ? resolveEndpointFeatureKey(snapshot, endpoint) : undefined;
  if (!key) return () => true;
  return owner => isFeatureOwnerEnabled(snapshot, owner, key);
}

function adapterIsExternal(snapshot: RuntimeSnapshot, owner: PluginId, turn?: TurnAccessContext): boolean {
  const endpoint = turn?.origin.kind === 'im' ? turn.origin.conversation?.endpoint.id : undefined;
  const adapters = snapshot.projections.get(adapterFeatureId);
  if (!endpoint || !isAdapterIndex(adapters)) return false;
  try {
    const adapterOwner = adapters.owner(endpoint as CapabilityId);
    if (adapterOwner === owner) return false;
    return !isTrustedOfficialAdapterPackage(snapshot.tree.get(adapterOwner)?.packageName);
  } catch {
    return false;
  }
}

/**
 * Segments come from the sealed generation's Scopes, so a replaced generation drops them. Text
 * segments from a plugin other than the agent owner are third-party content: their text is
 * labelled so it cannot claim owner authority (same rule as plugin prompt sections, #726).
 */
export function collectPromptSegments(snapshot: RuntimeSnapshot, owner: PluginId): readonly PromptSegment[] {
  const out: PromptSegment[] = [];
  for (const [plugin, resources] of snapshot.resources) {
    for (const segment of promptSegmentsOf(resources.get(promptSegmentToken.id))) {
      const thirdParty = plugin !== owner && isTextSegmentKind(segment.kind);
      out.push(thirdParty
        ? {
            ...segment,
            inject: (input) => {
              const text = segment.inject(input);
              return typeof text === 'string' && text.trim()
                ? labelThirdPartyGuidance(`plugin:${String(plugin)}`, text)
                : text;
            },
          } as PromptSegment
        : segment);
    }
  }
  return Object.freeze(out);
}

async function bindAgents(
  index: AgentIndex | undefined,
  owner: PluginId,
  turn?: TurnAccessContext,
  host?: PermissionHost,
): Promise<readonly AgentDescriptor[]> {
  if (!index) return Object.freeze([]);
  const access = await Promise.all(index.visible(owner).map(async (descriptor) => ({
    descriptor,
    allowed: await canAccessDescriptor(descriptor, turn, host),
  })));
  return Object.freeze(access.filter(({ allowed }) => allowed).map(({ descriptor }) => descriptor));
}

function resolveSeamIntegration(snapshot: RuntimeSnapshot): SeamIntegration | undefined {
  const value = snapshot.resources.get(snapshot.root)?.get(capabilitySeamToken.id);
  return value
    && typeof (value as SeamIntegration).projectTools === 'function'
    && typeof (value as SeamIntegration).projectSkills === 'function'
    ? value as SeamIntegration
    : undefined;
}

async function bindSeamTools(
  seam: SeamIntegration,
  owner: PluginId,
  isActive: () => boolean,
  turn?: TurnAccessContext,
  host?: PermissionHost,
  localAssets?: LocalImageAssetStore,
): Promise<readonly ToolCapability[]> {
  const projected = seam.projectTools(String(owner)).map((entry) => Object.freeze({
    owner,
    name: entry.schema.function.name,
    qualifiedName: entry.schema.function.name,
    description: entry.schema.function.description,
    inputSchema: entry.schema.function.parameters,
    requiresApproval: entry.schema.requiresApproval ?? 'on-risk',
    ...(entry.schema.risk ? { risk: entry.schema.risk } : {}),
    ...(entry.schema.riskCategory ? { riskCategory: entry.schema.riskCategory } : {}),
    platforms: entry.schema.platforms,
    scopes: entry.schema.scopes,
    currentConversationBotRoles: entry.schema.currentConversationBotRoles,
    permissions: entry.schema.permissions,
    hidden: entry.schema.hidden,
    source: entry.schema.source ?? `seam:${entry.providerId}`,
    execute: async <TInput = unknown, TResult = unknown>(
      input: TInput,
      invocation: ToolInvocationContext,
    ): Promise<TResult> => {
      assertActive(isActive);
      const result = await entry.execute(input, invocation);
      if (!result.success) throw new Error(result.error ?? `Seam Tool failed: ${entry.schema.function.name}`);
      return await captureToolImages(result.output, localAssets, invocation, entry.schema.function.name, invocation.signal) as TResult;
    },
  } satisfies ToolCapability));
  const access = await Promise.all(projected.map(async (descriptor) => ({
    descriptor,
    allowed: await canAccessDescriptor(descriptor, turn, host),
  })));
  return Object.freeze(access.filter(({ allowed }) => allowed).map(({ descriptor }) => descriptor));
}

async function bindSeamSkills(
  seam: SeamIntegration,
  owner: PluginId,
  turn?: TurnAccessContext,
  host?: PermissionHost,
): Promise<readonly SkillDescriptor[]> {
  const projected = (await seam.projectSkills(String(owner))).map((entry) => Object.freeze({
    $feature: 'zhin.skill/1' as const,
    owner,
    name: entry.metadata.name,
    qualifiedName: entry.metadata.name,
    description: entry.metadata.description,
    instructions: entry.instructions,
    toolNames: entry.metadata.toolNames,
    platforms: entry.metadata.platforms,
    scopes: entry.metadata.scopes,
    permissions: entry.metadata.permissions,
    keywords: entry.metadata.keywords,
    tags: entry.metadata.tags,
    always: entry.metadata.always,
    source: `seam:${entry.providerId}`,
  } satisfies SkillDescriptor));
  const access = await Promise.all(projected.map(async (descriptor) => ({
    descriptor,
    allowed: await canAccessDescriptor(descriptor, turn, host),
  })));
  return Object.freeze(access.filter(({ allowed }) => allowed).map(({ descriptor }) => descriptor));
}

async function bindSkills(
  index: SkillIndex | undefined,
  turn?: TurnAccessContext,
  host?: PermissionHost,
  selectedAgent?: string,
): Promise<readonly SkillDescriptor[]> {
  if (!index) return Object.freeze([]);
  const access = await Promise.all(index.list().map(async (descriptor) => ({
    descriptor,
    allowed: belongsToSelectedAgent(descriptor.agentName, selectedAgent)
      && await canAccessDescriptor(descriptor, turn, host),
  })));
  return Object.freeze(access.filter(({ allowed }) => allowed).map(({ descriptor }) => descriptor));
}

function belongsToSelectedAgent(agentName: string | undefined, selectedAgent: string | undefined): boolean {
  if (!agentName) return true;
  return selectedAgent === agentName || selectedAgent?.endsWith(`__${agentName}`) === true;
}

function assertDistinctCapabilities(
  kind: 'Tool' | 'Skill',
  capabilities: readonly { name: string }[],
): void {
  const names = new Set<string>();
  for (const capability of capabilities) {
    if (names.has(capability.name)) throw new Error(`Duplicate Agent ${kind} capability: ${capability.name}`);
    names.add(capability.name);
  }
}

interface BindToolsInput {
  readonly index: ToolIndex | undefined;
  readonly owner: PluginId;
  readonly isActive: () => boolean;
  readonly turn?: TurnAccessContext;
  readonly host?: PermissionHost;
  readonly selectedAgent?: string;
  readonly operationSnapshot?: RuntimeSnapshot;
  readonly operation?: CapabilityOperationFactory;
  /** Host private image store; image blocks in tool results are captured here before the journal. */
  readonly localAssets?: LocalImageAssetStore;
}
async function bindTools(input: BindToolsInput): Promise<readonly ToolCapability[]> {
  const { index, owner, isActive, turn, host, selectedAgent, operationSnapshot, operation, localAssets } = input;
  if (!index) return Object.freeze([]);
  const descriptors = index.list();
  const accessResults = await Promise.all(
    descriptors.map(async (descriptor) => ({
      descriptor,
      allowed: await canAccessDescriptor(descriptor, turn, host),
    })),
  );
  return Object.freeze(accessResults
    .filter((r) => r.allowed)
    // Static capability queries have no session. Actual TurnRequest ingress always supplies one.
    // Apply eligibility after access checks so all resident/deferred/load paths share this ceiling.
    .filter(({ descriptor }) => !turn?.session
      || index.isAvailable(descriptor.owner, descriptor.name, { sessionKey: turn.session.key, origin: turn.origin,
        ...(turn.input?.contextState?.bot?.profile ? { accountProfile: { writableFields: turn.input.contextState.bot.profile.writableFields } } : {}),
        principal: { subjectId: turn.principal.subjectId, roles: turn.principal.roles },
      }))
    .map((r) => Object.freeze({
      ...r.descriptor,
      hidden: isSelectedAgentTool(r.descriptor.placement, selectedAgent)
        ? false
        : r.descriptor.hidden,
      name: r.descriptor.qualifiedName,
      execute: async <TInput, TResult>(input: TInput, invocation: ToolInvocationContext): Promise<TResult> => {
        assertActive(isActive);
        const result = await index.execute<TInput, TResult>({ requester: r.descriptor.owner, name: r.descriptor.name, input, invocation, snapshot: operationSnapshot, operation });
        return await captureToolImages(result, localAssets, invocation, r.descriptor.qualifiedName, invocation.signal) as TResult;
      },
    })));
}

function isSelectedAgentTool(
  placement: ToolDescriptor['placement'],
  selectedAgent: string | undefined,
): boolean {
  return placement?.kind === 'agent'
    && belongsToSelectedAgent(placement.agent, selectedAgent);
}

async function canAccessDescriptor(
  descriptor: Pick<ToolDescriptor, 'platforms' | 'scopes' | 'permissions' | 'currentConversationBotRoles'> & {
    readonly requiresCapabilities?: readonly string[];
  },
  turn: TurnAccessContext | undefined,
  host?: PermissionHost,
): Promise<boolean> {
  if (descriptor.platforms?.length) {
    if (turn?.origin.kind !== 'im' || !descriptor.platforms.includes(turn.origin.platform)) {
      return false;
    }
  }
  if (descriptor.scopes?.length) {
    if (turn?.origin.kind !== 'im' || !descriptor.scopes.includes(turn.origin.scope)) {
      return false;
    }
  }
  // ADR 0044: the per-turn platform capabilities (static profile narrowed by Bot role, mute, adapter
  // resolver) decide visibility. Missing capabilities fail closed, so no platform name or keyword is read.
  if (descriptor.requiresCapabilities?.length) {
    const platformCapabilities = turn?.input?.platformCapabilities;
    if (!platformCapabilities || !descriptor.requiresCapabilities.every((path) => platformCapabilities.has(path))) {
      return false;
    }
  }
  if (descriptor.currentConversationBotRoles?.length) {
    const role = turn?.origin.kind === 'im' ? turn.input?.contextState?.bot?.platformRole : undefined;
    if (!role || !descriptor.currentConversationBotRoles.includes(role)) return false;
  }
  if (!descriptor.permissions?.length) return true;
  if (!turn || !host) return false;
  return host.checkAll(descriptor.permissions, turnPermissionSubject(turn));
}

/** Root resources 上的 PermissionHost（command-index 同款解析；未安装时 fail-closed）。 */
function resolvePermissionHost(snapshot: RuntimeSnapshot): PermissionHost | undefined {
  try {
    const resources = snapshot.resources.get(snapshot.root);
    const host = resources?.get(permissionHostToken.id);
    return host && typeof (host as PermissionHost).check === 'function'
      ? host as PermissionHost
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveLocalAssets(snapshot: RuntimeSnapshot): LocalImageAssetStore | undefined {
  return snapshot.resources.get(snapshot.root)?.get(localImageAssetsToken.id) as LocalImageAssetStore | undefined;
}

function bindMcp(
  index: McpIndex | undefined,
  owner: PluginId,
  isActive: () => boolean,
  localAssets?: LocalImageAssetStore,
): readonly McpCapability[] {
  if (!index) return Object.freeze([]);
  return Object.freeze(index.visible(owner).map((descriptor) => Object.freeze({
    ...descriptor,
    listTools: () => {
      assertActive(isActive);
      return index.listTools(owner, descriptor.name);
    },
    callTool: async <TResult>(tool: string, input: unknown, invocation?: ToolInvocationContext) => {
      assertActive(isActive);
      const result = await index.callTool(owner, descriptor.name, tool, input);
      return await captureToolImages(result, localAssets, invocation, `${descriptor.qualifiedName}/${tool}`, invocation?.signal) as TResult;
    },
  })));
}

function assertActive(isActive: () => boolean): void {
  if (!isActive()) throw new Error('Agent capability turn scope has ended');
}

function projection<T>(
  snapshot: RuntimeSnapshot,
  id: FeatureId,
  guard: (value: unknown) => value is T,
): T | undefined {
  const value = snapshot.projections.get(id);
  return guard(value) ? value : undefined;
}
