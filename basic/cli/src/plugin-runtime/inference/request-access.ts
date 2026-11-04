import type {
  CredentialGrant,
  CredentialPort,
  ProviderAccount,
  ProviderService,
} from '@zhin.js/ai/provider';
import { InferenceAuthenticationError } from './credentials.js';

/** Private, in-flight evidence; never a public Trace, graph or persistent audit record. */
export interface CredentialTransportFact {
  readonly accountId: string;
  readonly incarnation: string;
  readonly serviceId: string;
  readonly authenticationContract: string;
  readonly credentialRevision: string;
  readonly phase: 'transport-attempted' | 'response';
  readonly status?: number;
}
interface IssuedGrant {
  readonly target: string;
  readonly revision: string;
}
interface BoundRequest extends IssuedGrant {
  attempted: boolean;
  /** Followers must live with the Driver-held final Request through response consumption. */
  readonly transport: Set<Request | AbortSignal>;
}
export interface CredentialRequestAccessOptions {
  readonly account: ProviderAccount;
  readonly service: ProviderService;
  readonly authenticationContract: string;
  readonly credentials: CredentialPort;
  /** Same trusted accounting boundary as the ordinary inference transport. */
  readonly beforeSubmit?: () => void;
  /** Process-private observer. Failure cannot change transport or authentication state. */
  readonly observe?: (fact: CredentialTransportFact) => void | Promise<void>;
  readonly network: (
    beforeSubmit: () => void,
    retainTransportState: (state: Request | AbortSignal) => void
  ) => typeof globalThis.fetch;
  /** Discovery has a transaction owner rather than a long-lived execution handle. */
  readonly retainBoundRequest?: (request: Request) => void;
}

/** A grant is signed by object identity in this port, not by a caller-supplied revision.
 * The Request remains associated only while it is held; this is not historical auditing. */
export function createCredentialRequestAccess(options: CredentialRequestAccessOptions) {
  const issued = new WeakMap<CredentialGrant, IssuedGrant>();
  const requests = new WeakMap<Request, BoundRequest>();
  function note(
    bound: BoundRequest,
    phase: CredentialTransportFact['phase'],
    status?: number
  ): void {
    try {
      const result = options.observe?.({
        accountId: options.account.id,
        incarnation: options.account.incarnation,
        serviceId: options.service.id,
        authenticationContract: options.authenticationContract,
        credentialRevision: bound.revision,
        phase,
        ...(status === undefined ? {} : { status }),
      });
      if (result) void Promise.resolve(result).catch(() => undefined);
    } catch {
      /* Observation never controls submission, its result or credential state. */
    }
  }
  const credentials: CredentialPort = Object.freeze({
    async authorize(input: Parameters<CredentialPort['authorize']>[0]) {
      const target = new URL(input.target);
      const grant = await options.credentials.authorize({ ...input, target });
      issued.set(grant, { target: target.href, revision: grant.revision });
      return grant;
    },
    bindRequest({ grant, request }: Parameters<CredentialPort['bindRequest']>[0]) {
      const fact = issued.get(grant);
      if (!fact || fact.target !== request.url)
        throw new InferenceAuthenticationError('target-denied');
      requests.set(request, {
        ...fact,
        attempted: false,
        transport: new Set(),
      });
      options.retainBoundRequest?.(request);
      return request;
    },
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    // Read original ownership before the network boundary clones a Request.
    const bound = input instanceof Request ? requests.get(input) : undefined;
    if (!bound || (init && Object.keys(init).some((key) => key !== 'signal')))
      throw new InferenceAuthenticationError('target-denied');
    const network = options.network(
      () => {
        options.beforeSubmit?.();
        bound.attempted = true;
        note(bound, 'transport-attempted');
      },
      (state) => {
        bound.transport.add(state);
      }
    );
    const response = await network(input, init);
    if (bound.attempted) note(bound, 'response', response.status);
    return response;
  };
  return Object.freeze({ credentials, fetch });
}
