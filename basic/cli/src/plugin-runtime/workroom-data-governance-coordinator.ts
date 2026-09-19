import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ActivatableWorkroomJournal } from '@zhin.js/agent';
import {
  createCatalogGovernedConsoleDisclosureAuthority,
  createFileWorkroomDataLifecycleRuntime,
  createGenerationOwnedWorkroomDataGovernanceStorage,
  createGenerationOwnedWorkroomGovernedOutboundComposition,
  installWorkroomDataGovernanceResources,
  resolveWorkroomDataGovernanceRootAuthorities,
  workroomAcceptanceProjectionSourceAuthorityToken,
  type WorkroomAcceptanceProjectionSourceAuthorityPort,
  type WorkroomPayloadLifecycleIndexPort,
} from '@zhin.js/agent/runtime';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { LocalWorkroomDataGovernanceAuthority } from './local-workroom-data-governance.js';
import type { WorkroomRuntimeFoundation } from './workroom-runtime-foundation.js';

type RootResourceContext = Parameters<RootResourceInstaller>[0];
type DataGovernanceRuntime = ReturnType<typeof installWorkroomDataGovernanceResources>;
type DataGovernanceStorage = ReturnType<typeof createGenerationOwnedWorkroomDataGovernanceStorage>;
type PayloadPublicationVerifier = NonNullable<
  Parameters<typeof installWorkroomDataGovernanceResources>[0]['payloadPublicationVerifier']
>;
type PublicationIntent = Parameters<PayloadPublicationVerifier['verify']>[0];
type PublicationResult = Awaited<ReturnType<PayloadPublicationVerifier['verify']>>;

interface ReportPayloadPublicationVerifier {
  verifyGovernedPayloadPublication(intent: PublicationIntent): Promise<PublicationResult>;
}

export interface WorkroomDataGovernanceCoordinatorOptions {
  readonly projectRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: RootResourceContext['resources'];
  readonly usesDatabase: boolean;
  readonly foundation: WorkroomRuntimeFoundation;
  readonly localAuthority?: LocalWorkroomDataGovernanceAuthority;
}

/** Owns Root authority resolution, governed storage, lifecycle, and reconciliation. */
export class WorkroomDataGovernanceCoordinator {
  readonly runtime: DataGovernanceRuntime;
  readonly storage: DataGovernanceStorage | undefined;
  readonly lifecycle: ReturnType<typeof createFileWorkroomDataLifecycleRuntime> | undefined;
  readonly localAuthority: LocalWorkroomDataGovernanceAuthority | undefined;
  readonly governedOutbound: ReturnType<
    typeof createGenerationOwnedWorkroomGovernedOutboundComposition
  >;

  readonly #publicationVerifier: PayloadPublicationVerifierRouter;
  readonly #foundation: WorkroomRuntimeFoundation;
  #handoffRegistered = false;

  private constructor(state: Readonly<{
    runtime: DataGovernanceRuntime;
    storage?: DataGovernanceStorage;
    lifecycle?: ReturnType<typeof createFileWorkroomDataLifecycleRuntime>;
    localAuthority?: LocalWorkroomDataGovernanceAuthority;
    governedOutbound: ReturnType<typeof createGenerationOwnedWorkroomGovernedOutboundComposition>;
    publicationVerifier: PayloadPublicationVerifierRouter;
    foundation: WorkroomRuntimeFoundation;
  }>) {
    this.runtime = state.runtime;
    this.storage = state.storage;
    this.lifecycle = state.lifecycle;
    this.localAuthority = state.localAuthority;
    this.governedOutbound = state.governedOutbound;
    this.#publicationVerifier = state.publicationVerifier;
    this.#foundation = state.foundation;
  }

  static async create(
    options: WorkroomDataGovernanceCoordinatorOptions,
  ): Promise<WorkroomDataGovernanceCoordinator> {
    const stateRoot = join(options.projectRoot, '.zhin');
    mkdirSync(stateRoot, { recursive: true });
    const rootAuthorities = await resolveWorkroomDataGovernanceRootAuthorities({
      resources: options.resources,
      generation: options.generation,
      requester: rootPluginId(),
      signal: options.signal,
    });
    const localAuthority = rootAuthorities ? undefined : options.localAuthority;
    const cryptography = rootAuthorities?.cryptography ?? localAuthority?.cryptography;
    const governance = rootAuthorities?.governance ?? localAuthority?.verification;
    const storage = cryptography
      ? createGenerationOwnedWorkroomDataGovernanceStorage({
          stateRoot,
          generation: options.generation,
          cryptography,
        })
      : undefined;
    if (storage && !options.usesDatabase) await storage.activateFile();

    const lifecycleAuthorities = rootAuthorities?.lifecycle ?? localAuthority?.lifecycle;
    const lifecycle = storage && lifecycleAuthorities
      ? createFileWorkroomDataLifecycleRuntime({
          stateRoot,
          generation: options.generation,
          signal: options.signal,
          journal: storage.lifecycle,
          clock: lifecycleAuthorities.clock,
          authority: lifecycleAuthorities.authority,
          subjects: lifecycleAuthorities.subjects,
          deletion: lifecycleAuthorities.deletion,
          receipts: lifecycleAuthorities.receipts,
          objects: Object.freeze({
            resolve: async (
              handle: Parameters<
                Parameters<typeof createFileWorkroomDataLifecycleRuntime>[0]['objects']['resolve']
              >[0],
              operationSignal: AbortSignal,
            ) =>
              await storage.vault.resolveLifecycleObject?.(handle, operationSignal),
          }),
          ...(lifecycleAuthorities.console
            ? {
                consoleAuthority: lifecycleAuthorities.console,
                consoleDisclosure: createCatalogGovernedConsoleDisclosureAuthority({
                  catalog: options.foundation.catalog,
                  governance: options.foundation.governance,
                }),
              }
            : {}),
        })
      : undefined;
    const publicationVerifier = new PayloadPublicationVerifierRouter(options.foundation.journal);
    const runtime = installWorkroomDataGovernanceResources({
      projectRoot: options.projectRoot,
      generation: options.generation,
      signal: options.signal,
      resources: options.resources,
      ...(cryptography ? { cryptography } : {}),
      ...(governance ? { governance } : {}),
      ...(storage ? { vault: storage.vault } : {}),
      ...(lifecycle && lifecycleAuthorities
        ? {
            payloadLifecycleIndex: Object.freeze({
              register: async (input, operationSignal) => {
                const state = await lifecycle.control.register({
                  version: 1,
                  operationId: input.operationId,
                  authenticatedPrincipalId: lifecycleAuthorities.registrationPrincipalId,
                  handle: input.handle,
                }, operationSignal);
                return Object.freeze({ digest: state.digest });
              },
            } satisfies WorkroomPayloadLifecycleIndexPort),
          }
        : {}),
      ...(lifecycleAuthorities ? { payloadPurge: lifecycleAuthorities.orphanPurge } : {}),
      payloadPublicationVerifier: publicationVerifier,
      acceptanceProjectionSources: Object.freeze({
        async resolve(input, operationSignal) {
          if (!options.resources.has(workroomAcceptanceProjectionSourceAuthorityToken)) {
            return undefined;
          }
          return await options.resources.use(workroomAcceptanceProjectionSourceAuthorityToken)
            .resolve(input, operationSignal);
        },
      } satisfies WorkroomAcceptanceProjectionSourceAuthorityPort),
    });
    options.foundation.bindDataGovernance(runtime);
    return new WorkroomDataGovernanceCoordinator({
      runtime,
      storage,
      lifecycle,
      localAuthority,
      governedOutbound: createGenerationOwnedWorkroomGovernedOutboundComposition({
        generation: options.generation,
        signal: options.signal,
        runtime,
      }),
      publicationVerifier,
      foundation: options.foundation,
    });
  }

  registerHandoff(handoff: RootResourceContext['handoff']): void {
    if (this.#handoffRegistered) {
      throw new Error('Workroom data governance handoff is already registered');
    }
    handoff.add({
      activateNext: async operationSignal => {
        const catalog = await this.#foundation.catalog.read();
        await this.runtime.reconcilePayloadPurges(
          Object.keys(catalog.definitions).sort(),
          operationSignal,
        );
      },
    });
    this.#handoffRegistered = true;
  }

  bindReportPayloadVerifier(verifier: ReportPayloadPublicationVerifier): void {
    this.#publicationVerifier.bindReports(verifier);
  }
}

class PayloadPublicationVerifierRouter implements PayloadPublicationVerifier {
  #reports?: ReportPayloadPublicationVerifier;

  constructor(private readonly journal: ActivatableWorkroomJournal) {}

  bindReports(verifier: ReportPayloadPublicationVerifier): void {
    if (this.#reports) throw new Error('Workroom report payload verifier is already bound');
    this.#reports = verifier;
  }

  async verify(
    intent: PublicationIntent,
    operationSignal: AbortSignal,
  ): Promise<PublicationResult> {
    operationSignal.throwIfAborted();
    if (intent.consumer === 'journal_header') {
      const verification = this.journal.verifyGovernedPayloadPublication
        ? await this.journal.verifyGovernedPayloadPublication(intent)
        : Object.freeze({ status: 'unknown' as const });
      return verification.status === 'missing'
        ? Object.freeze({ status: 'unknown' as const })
        : verification;
    }
    if ((intent.consumer === 'evidence_header'
      || intent.consumer === 'task_report_header') && this.#reports) {
      return await this.#reports.verifyGovernedPayloadPublication(intent);
    }
    return Object.freeze({ status: 'unknown' as const });
  }
}
