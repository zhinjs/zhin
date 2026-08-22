import { createToken } from '@zhin.js/plugin-runtime';
import type {
  WorkroomRemoteAssignmentAuthorityInput,
  WorkroomRemoteAssignmentAuthorityPort,
  WorkroomRemoteAssignmentResolvedAuthority,
} from '../workroom/remote-assignment-issuance.js';

/**
 * Supplied only by the Project Profile/Capability composition root after it
 * can resolve an exact current generation authority intersection.
 */
export const workroomRemoteAssignmentAuthorityToken =
  createToken<WorkroomRemoteAssignmentAuthorityPort>(
    'zhin.agent.workroom-remote-assignment-authority',
    'Current generation Profile/Capability/Agent/Endpoint Remote Assignment authority',
  );

/** HMR-safe proxy: no Kernel captures a retired generation authority port. */
export function createGenerationWorkroomRemoteAssignmentAuthority(
  resolve: () => WorkroomRemoteAssignmentAuthorityPort | undefined,
): WorkroomRemoteAssignmentAuthorityPort {
  return Object.freeze({
    async resolve(
      input: WorkroomRemoteAssignmentAuthorityInput,
    ): Promise<WorkroomRemoteAssignmentResolvedAuthority> {
      const current = resolve();
      if (!current) {
        throw new Error(
          'Remote Assignment authority is unavailable: active Project Profile/Capability '
          + 'and endpoint authority must be installed',
        );
      }
      return await current.resolve(input);
    },
  });
}
