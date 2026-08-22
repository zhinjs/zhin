import { join } from 'node:path';
import { createToken, type Scope } from '@zhin.js/plugin-runtime';
import {
  WorkroomEffectLedger,
  type WorkroomEffectIntent,
  type WorkroomEffectState,
} from '../workroom/effect-ledger.js';
import { FileWorkroomEffectJournal } from '../workroom/file-effect-ledger.js';
import {
  DurableWorkroomEffectBlockerControl,
  FileWorkroomEffectBlockerRepository,
} from '../workroom/effect-blocker-repository.js';
import {
  GenerationOwnedP7EffectAuthorization,
  ProductionGitWorkroomEffectGateway,
  workroomGitBranchProtectionAuthorityToken,
  workroomGitHubCapabilityToken,
  workroomGitWorkspaceLeaseAuthorityToken,
  workroomPersistedEffectAuthorizationFactsToken,
} from './workroom-effect-production.js';
import {
  WorkroomEffectRuntime,
  type WorkroomEffectBlockerPolicyPort,
  type WorkroomEffectClockPort,
} from './workroom-effect-runtime.js';
import {
  WorkroomPayloadEffectGatewayRouter,
  workroomPayloadProcessorRecallProviderToken,
} from './workroom-payload-processor-recall.js';

export interface WorkroomEffectIntentWriterPort {
  record(intent: WorkroomEffectIntent): Promise<WorkroomEffectState>;
}

export const workroomEffectIntentWriterToken = createToken<WorkroomEffectIntentWriterPort>(
  'zhin.agent.workroom-effect-intent-writer',
  'Narrow content-addressed Effect Intent producer; never authorizes or executes',
);

export const workroomEffectRuntimeToken = createToken<WorkroomEffectRuntime>(
  'zhin.agent.workroom-effect-runtime',
  'Generation-owned durable Effect outbox and reconciliation runtime',
);

export interface InstallWorkroomEffectResourcesOptions {
  readonly projectRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: Pick<Scope, 'has' | 'provide' | 'use'>;
  readonly projects: Readonly<{ listProjectIds(): Promise<readonly string[]> }>;
  readonly clock: WorkroomEffectClockPort;
  readonly blockerPolicy: WorkroomEffectBlockerPolicyPort;
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
  readonly now?: () => number;
}

export interface WorkroomEffectComposition {
  readonly runtime: WorkroomEffectRuntime;
  readonly journal: FileWorkroomEffectJournal;
  readonly blockers: FileWorkroomEffectBlockerRepository;
  readonly intents: WorkroomEffectIntentWriterPort;
}

/**
 * Standard fail-closed composition. Git/P7 authorities are dynamically read
 * from the current generation Scope; absence blocks one exact Effect without
 * preventing the Agent Host generation from starting.
 */
export function installWorkroomEffectResources(
  options: InstallWorkroomEffectResourcesOptions,
): WorkroomEffectComposition {
  const stateRoot = join(options.projectRoot, '.zhin');
  const journal = new FileWorkroomEffectJournal(join(stateRoot, 'workroom-effect-ledger'));
  const blockerRepository = new FileWorkroomEffectBlockerRepository(
    join(stateRoot, 'workroom-effect-blockers'),
  );
  const authorization = new GenerationOwnedP7EffectAuthorization(() =>
    options.resources.has(workroomPersistedEffectAuthorizationFactsToken)
      ? options.resources.use(workroomPersistedEffectAuthorizationFactsToken)
      : undefined);
  const gitGateway = new ProductionGitWorkroomEffectGateway({
    generation: options.generation,
    ...(options.now ? { now: options.now } : {}),
    resolveLease: () => options.resources.has(workroomGitWorkspaceLeaseAuthorityToken)
      ? options.resources.use(workroomGitWorkspaceLeaseAuthorityToken)
      : undefined,
    resolveProtection: () => options.resources.has(workroomGitBranchProtectionAuthorityToken)
      ? options.resources.use(workroomGitBranchProtectionAuthorityToken)
      : undefined,
    resolveCapability: () => options.resources.has(workroomGitHubCapabilityToken)
      ? options.resources.use(workroomGitHubCapabilityToken)
      : undefined,
  });
  const gateway = new WorkroomPayloadEffectGatewayRouter({
    fallback: gitGateway,
    resolveProcessor: () => options.resources.has(workroomPayloadProcessorRecallProviderToken)
      ? options.resources.use(workroomPayloadProcessorRecallProviderToken)
      : undefined,
  });
  const runtime = new WorkroomEffectRuntime({
    journal,
    authorization,
    gateway,
    workerId: `effect-runtime:generation:${options.generation}`,
    fence: options.generation,
    projects: options.projects,
    clock: options.clock,
    blockers: new DurableWorkroomEffectBlockerControl(blockerRepository, options.now),
    blockerPolicy: options.blockerPolicy,
    signal: options.signal,
    ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const ledger = new WorkroomEffectLedger(journal);
  const intents = Object.freeze<WorkroomEffectIntentWriterPort>({
    record: async intent => await ledger.recordIntent(intent.projectId, intent),
  });
  provideIfAbsent(options.resources, workroomEffectIntentWriterToken, intents);
  provideIfAbsent(options.resources, workroomEffectRuntimeToken, runtime);
  return Object.freeze({ runtime, journal, blockers: blockerRepository, intents });
}

function provideIfAbsent<T>(
  resources: Pick<Scope, 'has' | 'provide'>,
  token: import('@zhin.js/plugin-runtime').Token<T>,
  value: T,
): void {
  if (!resources.has(token)) resources.provide(token, value);
}
