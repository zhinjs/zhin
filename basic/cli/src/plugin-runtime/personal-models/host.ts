import { PersistentRuntimePolicyRepository } from '../runtime-model-policy/state.js';
import { hostModelOwnerId } from './host-identity.js';
import { join, resolve } from 'node:path';
import type { AIService } from '@zhin.js/agent';
import { createScopedPerceptionFactory, type ModelRuntimeServiceOptions, type TurnModelPort } from '@zhin.js/agent/model-runtime';
import { personalSessionIdentity, personalSessionOwnerId, samePersonalSessionAddress, PersonalSessionService } from '@zhin.js/agent/personal-session';
import type { PersistentStatePort } from '@zhin.js/plugin-runtime';
import { PersonalModelStateStore } from './state.js';
import { createPersonalModelCredentialVault } from './credential-vault.js';
import { createPersonalModelFetch } from './network.js';

/** Host wiring; domain services never read process.env, filesystem credentials or IM metadata. */
export function createPersonalModelHost(options: Readonly<{
  projectRoot: string;
  state: () => PersistentStatePort | undefined;
  resolveHostSecret: (reference: string) => string | undefined | Promise<string | undefined>;
}>) {
  const rootId = resolve(options.projectRoot);
  const hostOwnerId = hostModelOwnerId(rootId);
  const state = new PersonalModelStateStore(options.state);
  const sessions = new PersonalSessionService(state);
  const runtimePolicy = new PersistentRuntimePolicyRepository({ rootId, hostOwnerId, state: options.state });
  const hasPolicyPersistence = options.state() !== undefined;
  const perception = createScopedPerceptionFactory();
  const vault = createPersonalModelCredentialVault({ directory: join(rootId, '.zhin', 'personal-model-credentials') });
  const runtimeOptions: Omit<ModelRuntimeServiceOptions, 'config' | 'hostProviders'> = {
    hostOwnerId, rootId,
    ...(hasPolicyPersistence ? { runtimePolicySnapshot: () => runtimePolicy.read() } : {}),
    secretResolver: async connection => {
      if (!connection.secretRef) return undefined;
      return connection.ownerId === hostOwnerId
        ? options.resolveHostSecret(connection.secretRef)
        : vault.resolve({ ownerId: connection.ownerId, secretRef: connection.secretRef });
    },
    personalCatalogSnapshot: async ownerId => (await state.loadCatalog(ownerId))?.value,
    personalFetchFactory: connection => {
      if (connection.ownerId === hostOwnerId) return undefined;
      if (!connection.baseUrl) throw new TypeError('Personal model endpoint is required');
      return createPersonalModelFetch({ baseUrl: connection.baseUrl });
    },
  };
  return Object.freeze({ rootId, hostOwnerId, state, sessions, vault, runtimeOptions, runtimePolicy,
    turnPort(service: AIService): TurnModelPort {
      const port: TurnModelPort = {
        createPerception: (scope, request) => perception({ scope, sessionKey: request.session.key,
          settings: service.getPerceptionConfig(), resilience: service.getAgentConfig()?.providerResilience }),
        acquire: async (request, binding) => {
          const personal = request.session.personal;
          let ownerId = hostOwnerId;
          let sessionSelection;
          if (personal) {
            const identity = personalSessionIdentity(personal);
            if (personal.rootId !== rootId || personal.subjectId !== request.principal.subjectId
              || identity.key !== request.session.key || request.origin.kind !== 'im'
              || personal.platform !== request.origin.platform || personal.endpoint !== request.origin.endpoint
              || !request.origin.conversation || !samePersonalSessionAddress(personal, { ...personal, conversation: request.origin.conversation })) {
              throw new Error('Personal Session does not match trusted turn identity');
            }
            // A Host without persistent-state support has no personal model capability.
            // A configured but failing database must propagate its error, never select another model.
            if (options.state()) {
              ownerId = personalSessionOwnerId(identity.owner);
              sessionSelection = (await sessions.read({ address: personal, owner: identity.owner })).selection;
            }
          }
          const origin = request.origin.kind === 'im' && request.origin.conversation
            ? { platform: request.origin.platform, endpoint: request.origin.endpoint, conversation: request.origin.conversation }
            : undefined;
          return service.getModelRuntime().acquireForTurn({ rootId, ownerId, origin,
            sessionSelection, bindingName: binding.name }, request.signal);
      } };
      return Object.freeze(port);
    },
  });
}
