import type { HostModelSelection, ModelExecutionLease } from '@zhin.js/agent/model-runtime';
import type { ModelConfigurationAccess } from '../personal-models/configuration.js';
import { getLogger } from '@zhin.js/logger';

/** Deployment reviewer/judge authority is independent of the caller's personal chat model. */
export async function withHostDeploymentModel<T>(configuration: ModelConfigurationAccess,
  selection: HostModelSelection | undefined, signal: AbortSignal,
  operation: (model: ModelExecutionLease) => Promise<T>): Promise<T> {
  const model = await configuration.acquireHostModel(selection, signal);
  try { return await operation(model); }
  finally {
    try { await model.release(); }
    catch { try { getLogger('agent').warn('Deployment model lease cleanup failed'); } catch { /* Diagnostic only. */ } }
  }
}
