/** Evaluation borrows the same persisted graph, credentials and official Driver
 * declarations as the CLI's headless Host. It never constructs an alias directory. */
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { loadProjectConfig } from '../../../packages/toolkit/scaffold-wizard/src/project-config-plan.js';
import { normalizeDatabaseHostConfig } from '../../../packages/im/core/src/plugin-runtime/im/index.js';
import { openHeadlessInferenceHost } from '../../../packages/im/agent/src/plugin-runtime/index.js';
import { createProfileReference, type InferenceOperationScope, type JsonObject } from '../../../packages/im/ai/src/provider/index.js';
import type { LlmCompletionPort, Model } from '../../../packages/im/ai/src/index.js';
import { createInvocationCompletion, invocationModel } from '../../../packages/im/agent/src/model-runtime/completion.js';

export interface EvalModelSelection {
  readonly profile: string;
  readonly profileRevision: number;
  readonly graphRevision: number;
  readonly nativeModel: string;
  /** Explicit configured parameters; omitted vendor defaults remain unknown. */
  readonly profileParameters: JsonObject;
}
export interface EvalWorkspace {
  readonly dir: string;
  readonly runtime: LlmCompletionPort;
  readonly agentModel: string;
  readonly nickname?: string;
  model(profileId: string): Promise<Model>;
  selection(model: Model): EvalModelSelection;
  close(): Promise<void>;
}

/** Environment expansion for explicit process ports. This module does not read dotenv. */
export function resolveEnvReferences<T>(value: T, env: Record<string, string | undefined>): T {
  if (typeof value === 'string') return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => env[name] ?? '') as T;
  if (Array.isArray(value)) return value.map(item => resolveEnvReferences(item, env)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveEnvReferences(item, env)])) as T;
  return value;
}

/** Core adapter receives an already trusted Host scope. It cannot mint owners,
 * refresh credentials or discover/install a plugin independently. */
export function createEvalWorkspace(input: Readonly<{ dir: string; scope: InferenceOperationScope; defaultProfileId: string; nickname?: string; close: () => Promise<void> }>): EvalWorkspace {
  const completions = new WeakMap<Model, LlmCompletionPort>(), selections = new WeakMap<Model, EvalModelSelection>();
  const complete: LlmCompletionPort['complete'] = (model, context, options) => {
    const completion = completions.get(model);
    if (!completion) throw new Error('Evaluation model must come from this Host scope');
    return completion.complete(model, context, options);
  };
  return { dir: input.dir, runtime: { complete, completeSimple: complete }, agentModel: input.defaultProfileId,
    ...(input.nickname ? { nickname: input.nickname } : {}),
    async model(id) {
      const profile = input.scope.graph.profiles[id];
      if (!profile) throw new Error(`Unknown runtime Profile ID: ${id}. Legacy providerAlias/model references require explicit migration.`);
      const account = input.scope.graph.accounts[profile.accountId], service = input.scope.graph.services[account.serviceId];
      const reference = createProfileReference({ kind: 'language', binding: { graphRevision: input.scope.graph.revision, profile, account, service, model: service.models[profile.model] } });
      const binding = await input.scope.resolve({ kind: 'language', purpose: 'chat', profile: reference });
      const model = invocationModel(binding, await input.scope.describeModel({ purpose: 'chat', profile: reference }));
      completions.set(model, createInvocationCompletion({ binding, client: input.scope.client, purpose: 'chat' }));
      selections.set(model, Object.freeze({ profile: profile.id, profileRevision: profile.revision, graphRevision: input.scope.graph.revision,
        nativeModel: binding.model.id, profileParameters: binding.profile.parameters }));
      return model;
    },
    selection(model) { const value = selections.get(model); if (!value) throw new Error('Foreign evaluation model'); return value; },
    close: input.close,
  };
}

export async function loadEvalWorkspace(dir: string, options: Readonly<{ agentName?: string; profileId?: string }> = {}): Promise<EvalWorkspace> {
  const agentName = options.agentName ?? 'zhin';
  const loaded = loadProjectConfig(dir);
  if (loaded.status !== 'loaded') throw new Error(loaded.message ?? `No workspace configuration in ${dir}`);
  const config = loaded.config, rawDatabase = config.database;
  if (!rawDatabase || typeof rawDatabase !== 'object' || Array.isArray(rawDatabase)) throw new Error('Configure the workspace persistent inference database before evaluation');
  const database = normalizeDatabaseHostConfig(resolveEnvReferences({ ...rawDatabase }, process.env));
  if (database.dialect === 'sqlite' && typeof database.filename === 'string' && !isAbsolute(database.filename)) database.filename = join(dir, database.filename);
  const environment = await openHeadlessInferenceHost({ projectRoot: dir, database, resolveSource: source => {
    const variable = /^env:\/\/([A-Za-z_][A-Za-z0-9_]*)$/u.exec(source)?.[1];
    if (!variable) throw new Error('Invalid evaluation credential reference');
    return process.env[variable];
  } });
  const lease = environment.snapshots.acquire(), runtime = environment.host.createInference(lease);
  let scope: InferenceOperationScope | undefined;
  try {
    scope = await runtime.openScope({ context: { rootId: environment.host.rootId, hostOwnerId: environment.host.hostOwnerId,
      ownerId: environment.host.hostOwnerId, operationId: randomUUID(), sessionKey: `eval:chat:${randomUUID()}` } });
    const active = scope;
    const selectedId = options.profileId;
    let defaultProfileId: string;
    if (selectedId !== undefined) {
      if (!active.graph.profiles[selectedId]) throw new Error(`Unknown runtime Profile ID: ${selectedId}`);
      defaultProfileId = selectedId;
    } else {
      defaultProfileId = (await active.resolve({ kind: 'language', purpose: agentName === 'zhin' ? 'chat' : `agent:${agentName}` })).profile.id;
    }
    let close: Promise<void> | undefined;
    return createEvalWorkspace({ dir, scope: active, defaultProfileId,
      nickname: (config.ai as { agents?: Record<string, { nickname?: string }> } | undefined)?.agents?.[agentName]?.nickname,
      close: () => close ??= (async () => { try { await active.close(); } finally { runtime.retire(); lease.release(); await environment.close(); } })(),
    });
  } catch (error) { try { await scope?.close(); } finally { runtime.retire(); lease.release(); await environment.close(); } throw error; }
}
