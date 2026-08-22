import { describe, expect, it } from 'vitest';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import {
  createGenerationWorkroomAcceptanceAuthority,
  workroomAcceptanceAuthorityToken,
} from '../../src/plugin-runtime/workroom-acceptance-authority.js';
import type { WorkroomAcceptanceAuthorizationInput } from '../../src/workroom/acceptance-control.js';

describe('generation Workroom acceptance authority', () => {
  it('fails closed before provision and echoes the current authority decision afterwards', async () => {
    const scope = new Scope(rootPluginId());
    const proxy = createGenerationWorkroomAcceptanceAuthority(() =>
      scope.has(workroomAcceptanceAuthorityToken)
        ? scope.use(workroomAcceptanceAuthorityToken)
        : undefined);
    const input = Object.freeze({
      action: 'claim_review',
      principalId: 'reviewer-1',
      requiredRole: 'reviewer',
      projectId: 'project-1',
      runId: 'run-1',
      taskKey: 'build',
      targetId: 'reviewer-assignment-1',
      expectedSequence: 7,
    }) satisfies WorkroomAcceptanceAuthorizationInput;

    await expect(proxy.authorize(input)).rejects.toThrow('Authority is not installed');

    scope.provide(workroomAcceptanceAuthorityToken, {
      authorize(request) {
        return Object.freeze({
          action: request.action,
          authorized: true as const,
          principalId: request.principalId,
          role: request.requiredRole,
          projectId: request.projectId,
          runId: request.runId,
          taskKey: request.taskKey,
          targetId: request.targetId,
          expectedSequence: request.expectedSequence,
          authorizedBy: `rbac:${request.projectId}:${request.expectedSequence}`,
        });
      },
    });

    await expect(proxy.authorize(input)).resolves.toEqual({
      authorized: true,
      principalId: 'reviewer-1',
      role: 'reviewer',
      action: 'claim_review',
      projectId: 'project-1',
      runId: 'run-1',
      taskKey: 'build',
      targetId: 'reviewer-assignment-1',
      expectedSequence: 7,
      authorizedBy: 'rbac:project-1:7',
    });
  });
});
