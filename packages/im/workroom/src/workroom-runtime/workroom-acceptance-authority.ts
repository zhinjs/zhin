import { createToken } from '@zhin.js/plugin-runtime';
import type {
  WorkroomAcceptanceAuthorityPort,
  WorkroomAcceptanceAuthorizationDecision,
  WorkroomAcceptanceAuthorizationInput,
} from '../workroom/acceptance-control.js';

export const workroomAcceptanceAuthorityToken = createToken<WorkroomAcceptanceAuthorityPort>(
  'zhin.agent.workroom-acceptance-authority',
  'Generation-owned Workroom Reviewer and Sponsor acceptance authority',
);

/** Resolve for every authorization so a turn never captures a retired generation authority. */
export function createGenerationWorkroomAcceptanceAuthority(
  resolve: () => WorkroomAcceptanceAuthorityPort | undefined,
): WorkroomAcceptanceAuthorityPort {
  return Object.freeze({
    async authorize(
      input: Readonly<WorkroomAcceptanceAuthorizationInput>,
    ): Promise<WorkroomAcceptanceAuthorizationDecision> {
      const current = resolve();
      if (!current) throw new Error('Workroom Acceptance Authority is not installed');
      return await current.authorize(input);
    },
  });
}
