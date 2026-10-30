import { getLogger } from '@zhin.js/logger';
import type { AIService } from '@zhin.js/agent';
import { runWithAgentTurnConfiguration } from '@zhin.js/agent/turn';
import { resolve } from 'node:path';
import { hostModelOwnerId } from './host-identity.js';

/** Operator management and Console branch work have no personal inference authority. */
export async function withDeploymentModelScope<T>(service: AIService, projectRoot: string, operation: () => Promise<T>): Promise<T> {
  const models = await service.getModelRuntime().acquireForTurn({ rootId: resolve(projectRoot), ownerId: hostModelOwnerId(projectRoot) });
  try {
    return await runWithAgentTurnConfiguration({ models, activeBinding: service.getBindingRegistry().requireZhinBinding() }, operation);
  } finally {
    try { await models.release(); }
    catch {
      try { getLogger('personal-models').warn('op=model_resource_release status=failed'); } catch { /* Diagnostic only. */ }
    }
  }
}
