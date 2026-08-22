import type {
  WorkroomDisclosureManifestAuthorityPort,
} from './workroom-data-governance-runtime.js';

export interface WorkroomGovernedDispatchGenerationBinding {
  readonly generation: number;
  readonly port: Pick<WorkroomDisclosureManifestAuthorityPort, 'revalidate'>;
}

export interface WorkroomGovernedOutboundComposition {
  readonly projection: WorkroomDisclosureManifestAuthorityPort;
  readonly remote: Pick<WorkroomDisclosureManifestAuthorityPort, 'revalidate'>;
}

/**
 * Generation composition for the two outbound sinks. Projection needs trusted
 * materialization; Remote gets revalidation only and cannot mint a Manifest.
 */
export function createGenerationOwnedWorkroomGovernedOutboundComposition(options: Readonly<{
  generation: number;
  signal: AbortSignal;
  runtime: Readonly<{
    generation: number;
    disclosureManifest: WorkroomDisclosureManifestAuthorityPort;
  }>;
}>): WorkroomGovernedOutboundComposition {
  if (options.runtime.generation !== options.generation) {
    throw new Error('Workroom governed outbound authority targets another Root generation');
  }
  return Object.freeze({
    projection: options.runtime.disclosureManifest,
    remote: createGenerationOwnedWorkroomGovernedDispatchPort({
      generation: options.generation,
      signal: options.signal,
      resolve: () => Object.freeze({
        generation: options.runtime.generation,
        port: options.runtime.disclosureManifest,
      }),
    }),
  });
}

export function createGenerationOwnedWorkroomGovernedDispatchPort(options: Readonly<{
  generation: number;
  signal: AbortSignal;
  resolve(): WorkroomGovernedDispatchGenerationBinding | undefined;
}>): Pick<WorkroomDisclosureManifestAuthorityPort, 'revalidate'> {
  if (!Number.isSafeInteger(options.generation) || options.generation < 1) {
    throw new Error('Workroom governed dispatch generation is invalid');
  }
  return Object.freeze({
    revalidate: async (...args: Parameters<WorkroomDisclosureManifestAuthorityPort['revalidate']>) => {
      options.signal.throwIfAborted();
      const current = options.resolve();
      if (!current) throw new Error('Workroom governed dispatch authority is unavailable');
      if (current.generation !== options.generation) {
        throw new Error('Workroom governed dispatch authority escaped its Root generation');
      }
      const operationSignal = args[1];
      const signal = AbortSignal.any([options.signal, operationSignal]);
      return await current.port.revalidate(args[0], signal);
    },
  });
}
