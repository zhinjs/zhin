import { createToken } from '@zhin.js/plugin-runtime';
import type {
  WorkroomLocalAssignmentAuthorityInput,
  WorkroomLocalAssignmentAuthorityPort,
  WorkroomLocalAssignmentResolvedAuthority,
} from './workroom-assignment-authority-provider.js';

export const workroomLocalAssignmentAuthorityToken =
  createToken<WorkroomLocalAssignmentAuthorityPort>(
    'zhin.agent.workroom-local-assignment-authority',
    'Current generation Profile/Capability/Agent/Workspace Local Assignment authority',
  );

/** HMR-safe proxy: Kernel never captures a retired local authority provider. */
export function createGenerationWorkroomLocalAssignmentAuthority(
  resolve: () => WorkroomLocalAssignmentAuthorityPort | undefined,
): WorkroomLocalAssignmentAuthorityPort {
  return Object.freeze({
    async resolveLocal(
      input: WorkroomLocalAssignmentAuthorityInput,
    ): Promise<WorkroomLocalAssignmentResolvedAuthority> {
      const current = resolve();
      if (!current) {
        throw new Error(
          'Local Assignment authority is unavailable: active Profile/Capability/Workspace grant '
          + 'must be installed',
        );
      }
      return await current.resolveLocal(input);
    },
  });
}
