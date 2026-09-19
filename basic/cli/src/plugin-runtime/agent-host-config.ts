import type {
  AIService,
  AssistantConfig,
  WorkroomDefinition,
  McpServerEntry,
} from '@zhin.js/agent';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  expandEnvironmentValue,
  type ConfigDocumentPort,
  type RuntimeConfigDocument,
} from '@zhin.js/runtime';

export type AgentHostAIConfig = NonNullable<ConstructorParameters<typeof AIService>[0]>;
export type WorkroomStorageMode = 'database' | 'file';

type McpServerConfig = NonNullable<AgentHostAIConfig['mcpServers']>[number];

type WorkroomModelProcessingContract = NonNullable<
  NonNullable<NonNullable<AgentHostAIConfig['workroom']>['disclosure']>['modelProviders']
>[string];

export interface WorkroomDisclosureBootstrapResolution {
  readonly modelProviderAlias?: string;
  readonly contract?: WorkroomModelProcessingContract;
}

export async function resolveAiConfig(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<AgentHostAIConfig | undefined> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return undefined;
  const ai = (document as Record<string, unknown>).ai;
  if (!ai || typeof ai !== 'object') return undefined;
  const expanded = expandEnvironmentValue(ai, (key) => process.env[key]) as AgentHostAIConfig;
  resolveWorkroomTrustedPackPublishers(expanded);
  return expanded;
}

export async function resolveAssistantConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<AssistantConfig | undefined> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return undefined;
  const assistant = (document as Record<string, unknown>).assistant;
  if (!assistant || typeof assistant !== 'object') return undefined;
  return expandEnvironmentValue(assistant, (key) => process.env[key]) as AssistantConfig;
}

export function resolveWorkroomTrustedPackPublishers(
  ai: AgentHostAIConfig | undefined,
): readonly string[] {
  const value = ai?.workroom?.trustedPackPublishers;
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new Error('ai.workroom.trustedPackPublishers must be an array');
  const normalized = value.map((principalId, index) => {
    if (typeof principalId !== 'string' || !principalId.trim() || principalId !== principalId.trim()) {
      throw new Error(`ai.workroom.trustedPackPublishers.${index} is invalid`);
    }
    return principalId;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('ai.workroom.trustedPackPublishers contains duplicates');
  }
  return Object.freeze(normalized);
}

export function resolveAgentHostMcpServers(
  ai: AgentHostAIConfig,
): readonly McpServerEntry[] {
  const raw = ai.mcpServers;
  if (raw == null) return Object.freeze([]);
  if (!Array.isArray(raw)) throw new TypeError('ai.mcpServers must be an array');
  return Object.freeze(raw.map((item, index) => {
    const entry = toMcpServerEntry(item);
    if (!entry) throw new TypeError(`Invalid ai.mcpServers[${index}] declaration`);
    return entry;
  }));
}

/** Resolve an explicitly configured project-local knowledge directory. */
export function resolveAgentHostKnowledgeDirectory(
  ai: AgentHostAIConfig,
  projectRoot: string,
): string | undefined {
  if (ai.knowledge === undefined) return undefined;
  const baseDir = ai.knowledge?.baseDir;
  if (typeof baseDir !== 'string' || !baseDir.trim() || baseDir !== baseDir.trim()) {
    throw new TypeError('ai.knowledge.baseDir must be a non-empty canonical path');
  }
  if (baseDir === '~' || baseDir.startsWith('~/') || baseDir.startsWith('~\\')) {
    throw new TypeError('ai.knowledge.baseDir must stay inside the project root');
  }
  if (isAbsolute(baseDir) || baseDir.split(/[\\/]/u).some((segment) => segment === '.' || segment === '..')) {
    throw new TypeError('ai.knowledge.baseDir must be a canonical project-relative path');
  }
  const root = realpathSync(resolve(projectRoot));
  const configured = resolve(root, baseDir);
  const directory = existsSync(configured) ? realpathSync(configured) : configured;
  const relation = relative(root, directory);
  if (relation === '..' || relation.startsWith('../') || relation.startsWith('..\\')) {
    throw new TypeError('ai.knowledge.baseDir must stay inside the project root');
  }
  return directory;
}

export function resolveWorkroomDisclosureBootstrap(
  definition: WorkroomDefinition | undefined,
  providerAliasForAgent: (agentId: string) => string | undefined,
  ai: AgentHostAIConfig,
): WorkroomDisclosureBootstrapResolution {
  const orchestratorAgent = definition?.conversation?.agent;
  const modelProviderAlias = orchestratorAgent
    ? providerAliasForAgent(orchestratorAgent)
    : undefined;
  const contract = modelProviderAlias
    ? ai.workroom?.disclosure?.modelProviders?.[modelProviderAlias]
    : undefined;
  return Object.freeze({
    ...(modelProviderAlias ? { modelProviderAlias } : {}),
    ...(contract ? { contract } : {}),
  });
}

export function assessWorkroomDisclosureSetup(input: Readonly<{
  resolution: WorkroomDisclosureBootstrapResolution;
  authorityPublished: boolean;
  authorityCurrent: boolean;
  localIssuerAvailable: boolean;
}>): Readonly<{
  disclosureReady: boolean;
  disclosureConfigReady: boolean;
  diagnostics: readonly string[];
}> {
  const { modelProviderAlias, contract } = input.resolution;
  const diagnostics: string[] = [];
  const disclosureConfigReady = contract !== undefined
    && contract.maxConfidentiality !== 'public'
    && (!contract.external || contract.noTraining);
  if (!modelProviderAlias) diagnostics.push('orchestrator 尚未绑定模型 Provider');
  else if (!contract) {
    diagnostics.push(`尚未配置 ai.workroom.disclosure.modelProviders.${modelProviderAlias}`);
  } else if (contract.external && !contract.noTraining) {
    diagnostics.push(`外部模型 Provider ${modelProviderAlias} 必须显式禁止训练`);
  } else if (contract.maxConfidentiality === 'public') {
    diagnostics.push(`模型 Provider ${modelProviderAlias} 至少需要 project_internal 披露等级`);
  }
  if (!input.authorityPublished) diagnostics.push('尚未发布 Project Data Governance 披露 authority');
  else if (!input.authorityCurrent) {
    diagnostics.push('Project Data Governance 披露 authority 未绑定当前 Catalog/Sponsor');
  }
  if (!input.localIssuerAvailable && !input.authorityCurrent) {
    diagnostics.push('Root-private Data Governance 签发能力不可用');
  }
  return Object.freeze({
    disclosureReady: input.authorityCurrent,
    disclosureConfigReady,
    diagnostics: Object.freeze(diagnostics),
  });
}

export function resolveWorkroomDisclosureAuthorityPublication(
  current: Readonly<{ revision: number; digest: string }> | undefined,
  authorityCurrent: boolean,
): Readonly<{ revision: number; previousDigest?: string }> | undefined {
  if (authorityCurrent) return undefined;
  return Object.freeze({
    revision: (current?.revision ?? 0) + 1,
    ...(current ? { previousDigest: current.digest } : {}),
  });
}

export function resolveWorkroomPlanningPolicyPublication(
  current: Readonly<{ revision: number; digest: string }> | undefined,
): Readonly<{ revision: number; expectedPreviousDigest?: string }> {
  return Object.freeze({
    revision: (current?.revision ?? 0) + 1,
    ...(current ? { expectedPreviousDigest: current.digest } : {}),
  });
}

export function isWorkroomPlanningPolicyReady(authority: Readonly<{
  policy: Readonly<{ schedulerPolicy: Readonly<{ pinnedAtSequence: number }> }>;
}> | undefined): boolean {
  return authority?.policy.schedulerPolicy.pinnedAtSequence === 1;
}

export function resolveWorkroomStorageMode(
  ai: AgentHostAIConfig | undefined,
): WorkroomStorageMode {
  return ai?.sessions?.useDatabase === false ? 'file' : 'database';
}

export function assertFixedWorkroomStorageMode(
  fixed: WorkroomStorageMode,
  requested: WorkroomStorageMode,
): void {
  if (requested === fixed) return;
  throw new Error(`Workroom storage mode changed from ${fixed} to ${requested}; process restart required`);
}

async function readConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<unknown> {
  if (!isConfigDocumentPort(config)) return config;
  return (await config.read()).document;
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConfigDocumentPort>;
  return typeof candidate.read === 'function';
}

function toMcpServerEntry(raw: McpServerConfig): McpServerEntry | undefined {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return undefined;
  const transport = raw.transport;
  if (transport !== 'stdio' && transport !== 'streamable-http' && transport !== 'sse') return undefined;
  if (transport === 'stdio') {
    if (!raw.command?.trim()) return undefined;
  } else if (!raw.url?.trim()) {
    return undefined;
  }
  return {
    name: raw.name.trim(),
    transport,
    ...(raw.url ? { url: raw.url } : {}),
    ...(raw.command ? { command: raw.command } : {}),
    ...(raw.args ? { args: [...raw.args] } : {}),
    ...(raw.env ? { env: { ...raw.env } } : {}),
    ...(raw.headers ? { headers: { ...raw.headers } } : {}),
  };
}
