import { createHash } from 'node:crypto';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  installWorkroomEffectResources,
  type WorkroomEffectBlockerPolicyPort,
  type WorkroomEffectClockPort,
} from '@zhin.js/agent/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { WorkroomRuntimeFoundation } from './workroom-runtime-foundation.js';

const logger = getLogger('agent');

type RootResourceContext = Parameters<RootResourceInstaller>[0];

export interface WorkroomEffectCoordinatorOptions {
  readonly projectRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: RootResourceContext['resources'];
  readonly lifecycle: RootResourceContext['lifecycle'];
  readonly handoff: RootResourceContext['handoff'];
  readonly runtime: WorkroomRuntimeFoundation;
}

/** Owns the durable Effect runtime, blocker policy, activation, and cleanup. */
export class WorkroomEffectCoordinator {
  readonly composition: ReturnType<typeof installWorkroomEffectResources>;

  constructor(options: WorkroomEffectCoordinatorOptions) {
    const { generation, signal, resources, lifecycle, handoff } = options;
    signal.throwIfAborted();
    const { catalog, kernel } = options.runtime;
    const emergencyPolicyBody = Object.freeze({
      kind: 'root_emergency_fallback' as const,
      ref: 'root-emergency-effect-blocker-policy:1',
      description: 'Conservative coordination blocker only; never authorizes an Effect',
    });
    const emergencyPolicy = Object.freeze({
      kind: emergencyPolicyBody.kind,
      ref: emergencyPolicyBody.ref,
      digest: `sha256:${createHash('sha256')
        .update(JSON.stringify(emergencyPolicyBody))
        .digest('hex')}`,
    });
    this.composition = installWorkroomEffectResources({
      projectRoot: options.projectRoot,
      generation,
      signal,
      resources,
      projects: Object.freeze({
        listProjectIds: async () => Object.freeze(Object.entries((await catalog.read()).definitions)
          .filter(([, definition]) => definition.enabled !== false)
          .map(([projectId]) => projectId)),
      }),
      clock: Object.freeze({
        read: async (state: Parameters<WorkroomEffectClockPort['read']>[0]) => (await kernel.read(
          state.intent.projectId,
          state.intent.runId,
        )).now,
      }),
      blockerPolicy: Object.freeze({
        resolve: async ({ state, phase }: Parameters<WorkroomEffectBlockerPolicyPort['resolve']>[0]) => {
          const [catalogSnapshot, run] = await Promise.all([
            catalog.read(),
            kernel.read(state.intent.projectId, state.intent.runId),
          ]);
          const definition = catalogSnapshot.definitions[state.intent.projectId];
          if (!definition || definition.enabled === false) {
            throw new Error('Effect blocker policy requires the current enabled Catalog Project');
          }
          const sponsors = [...new Set(definition.sponsors ?? [])];
          const owner = sponsors.length === 1
            ? `sponsor:${sponsors[0]}@catalog:${catalogSnapshot.revision}`
            : sponsors.length > 1
              ? `sponsor-set:${createHash('sha256').update(sponsors.sort().join('\0')).digest('hex')}@catalog:${catalogSnapshot.revision}`
              : `orchestrator:${definition.conversation?.agent ?? 'project-role'}@catalog:${catalogSnapshot.revision}`;
          return Object.freeze({
            owner,
            policy: emergencyPolicy,
            deadline: run.now + 60_000,
            allowedSuccessors: Object.freeze(phase === 'reconcile'
              ? ['reconcile', 'cancel'] as const
              : ['retry', 'cancel'] as const),
          });
        },
      }),
      intervalMs: 1_000,
      onError: error => logger.error(formatCompact({
        op: 'workroom_effect_runtime',
        error: error instanceof Error ? error.message : String(error),
      })),
    });
    lifecycle.add(() => this.composition.runtime.dispose());
    handoff.add({
      activateNext: operationSignal => {
        operationSignal.throwIfAborted();
        this.composition.runtime.start();
      },
    });
  }
}
