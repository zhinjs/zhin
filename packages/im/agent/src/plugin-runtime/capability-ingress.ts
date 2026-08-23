import type { FeatureId, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { permissionHostToken, type PermissionHost } from '@zhin.js/permission';
import { turnPermissionSubject, type TurnAccessContext } from '../turn/turn-ingress.js';
import {
  AgentIndex,
  agentFeatureId,
  type AgentDescriptor,
} from '@zhin.js/agent-feature';
import {
  McpIndex,
  mcpFeatureId,
  type McpDescriptor,
  type McpToolDescriptor,
} from '@zhin.js/mcp-feature';
import {
  SkillIndex,
  skillFeatureId,
  type SkillDescriptor,
} from '@zhin.js/skill';
import {
  ToolIndex,
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

export interface ToolCapability extends ToolDescriptor {
  execute<TInput = unknown, TResult = unknown>(
    input: TInput,
    invocation: ToolInvocationContext,
  ): Promise<TResult>;
}

export interface McpCapability extends McpDescriptor {
  listTools(): Promise<readonly McpToolDescriptor[]>;
  callTool<TResult = unknown>(tool: string, input: unknown): Promise<TResult>;
}

export interface AgentCapabilities {
  readonly generation: number;
  readonly owner: PluginId;
  readonly tools: readonly ToolCapability[];
  readonly skills: readonly SkillDescriptor[];
  readonly agents: readonly AgentDescriptor[];
  readonly mcp: readonly McpCapability[];
  readonly promptSections: readonly PromptSectionDescriptor[];
}

export class CapabilityIngress {
  async read(
    snapshot: RuntimeSnapshot,
    owner: PluginId,
    isActive: () => boolean = () => true,
    turn?: TurnAccessContext,
  ): Promise<AgentCapabilities> {
    if (!snapshot.tree.has(owner)) throw new Error(`Unknown Agent capability owner: ${owner}`);
    const tools = projection(snapshot, toolFeatureId, ToolIndex);
    const mcp = projection(snapshot, mcpFeatureId, McpIndex);
    const promptProjection = snapshot.projections.get(promptSectionFeatureId);
    const promptSections = isPromptSectionIndex(promptProjection) ? promptProjection : undefined;
    const promptProfile: PromptProfile = turn?.origin.kind === 'schedule' ? 'schedule' : 'interactive';
    return Object.freeze({
      generation: snapshot.generation,
      owner,
      tools: await bindTools(tools, owner, isActive, turn, resolvePermissionHost(snapshot)),
      skills: Object.freeze([
        ...(projection(snapshot, skillFeatureId, SkillIndex)?.visible(owner) ?? []),
      ]),
      agents: Object.freeze([
        ...(projection(snapshot, agentFeatureId, AgentIndex)?.visible(owner) ?? []),
      ]),
      mcp: bindMcp(mcp, owner, isActive),
      promptSections: Object.freeze([...(promptSections?.visible(owner, promptProfile) ?? [])]
        .filter((section) => !section.platforms
          || (turn?.origin.kind === 'im' && section.platforms.includes(turn.origin.platform)))),
    });
  }
}

async function bindTools(
  index: ToolIndex | undefined,
  owner: PluginId,
  isActive: () => boolean,
  turn?: TurnAccessContext,
  host?: PermissionHost,
): Promise<readonly ToolCapability[]> {
  if (!index) return Object.freeze([]);
  const visibleDescriptors = index.list();
  const accessResults = await Promise.all(
    visibleDescriptors.map(async (descriptor) => ({
      descriptor,
      allowed: !descriptor.hidden && await canAccessDescriptor(descriptor, turn, host),
    })),
  );
  return Object.freeze(accessResults
    .filter((r) => r.allowed)
    .map((r) => Object.freeze({
      ...r.descriptor,
      name: r.descriptor.qualifiedName,
      execute: <TInput, TResult>(input: TInput, invocation: ToolInvocationContext) => {
        assertActive(isActive);
        return index.execute<TInput, TResult>(r.descriptor.owner, r.descriptor.name, input, invocation);
      },
    })));
}

async function canAccessDescriptor(
  descriptor: ToolDescriptor,
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

function bindMcp(
  index: McpIndex | undefined,
  owner: PluginId,
  isActive: () => boolean,
): readonly McpCapability[] {
  if (!index) return Object.freeze([]);
  return Object.freeze(index.visible(owner).map((descriptor) => Object.freeze({
    ...descriptor,
    listTools: () => {
      assertActive(isActive);
      return index.listTools(owner, descriptor.name);
    },
    callTool: <TResult>(tool: string, input: unknown) => {
      assertActive(isActive);
      return index.callTool<TResult>(owner, descriptor.name, tool, input);
    },
  })));
}

function assertActive(isActive: () => boolean): void {
  if (!isActive()) throw new Error('Agent capability turn scope has ended');
}

function projection<T>(
  snapshot: RuntimeSnapshot,
  id: FeatureId,
  constructor: { readonly prototype: T },
): T | undefined {
  const value = snapshot.projections.get(id);
  return value
    && typeof value === 'object'
    && Object.prototype.isPrototypeOf.call(constructor.prototype, value)
    ? value as T
    : undefined;
}
