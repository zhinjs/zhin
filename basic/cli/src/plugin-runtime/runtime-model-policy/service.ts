import { RuntimePolicyStateError, runtimePolicyBelongsToRoot, type RuntimePolicyRepository, type RuntimePolicySnapshot } from '@zhin.js/agent/model-policy';
import type { ModelRuntimeService } from '@zhin.js/agent/model-runtime';

export class RuntimePolicyManagementError extends Error {
  constructor(readonly code: 'invalid_input' | 'conflict') { super(`Runtime model policy: ${code}`); }
}
/** Operator facade over the same runtime resolver and the one persisted desired override. */
export class RuntimePolicyManagementService {
  constructor(private readonly options: Readonly<{ rootId: string; repository: RuntimePolicyRepository; runtime: () => ModelRuntimeService }>) {}
  get rootId(): string { return this.options.rootId; }
  private view(snapshot: RuntimePolicySnapshot, runtime: ModelRuntimeService) {
    const catalog = runtime.getCatalogConfig();
    const presets = Object.values(catalog.presets).map(preset => {
      const model = catalog.models[preset.modelId];
      return Object.freeze({ id: preset.id, modelId: model.id, model: model.model, sdk: catalog.connections[model.connectionId].sdk });
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return Object.freeze({ ...snapshot, rootId: this.options.rootId, baseline: runtime.getPolicyBaseline(), presets: Object.freeze(presets) });
  }
  async read() {
    const runtime = this.options.runtime();
    const snapshot = await this.options.repository.read();
    if (!runtimePolicyBelongsToRoot(snapshot.refsOverride, this.options.rootId)) throw new RuntimePolicyStateError('integrity');
    return this.view(snapshot, runtime);
  }
  async replace(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Reflect.ownKeys(input).some(key => !['expectedRevision', 'refsOverride'].includes(String(key)))) {
      throw new RuntimePolicyManagementError('invalid_input');
    }
    const value = input as Record<string, unknown>;
    if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0
      || Number(value.expectedRevision) >= Number.MAX_SAFE_INTEGER || !Object.hasOwn(value, 'refsOverride')) {
      throw new RuntimePolicyManagementError('invalid_input');
    }
    const runtime = this.options.runtime();
    let refsOverride;
    try { refsOverride = runtime.validateRuntimePolicyOverride(value.refsOverride, this.options.rootId); }
    catch { throw new RuntimePolicyManagementError('invalid_input'); }
    const result = await this.options.repository.compareExchange(Number(value.expectedRevision), refsOverride);
    if (result.kind === 'conflict') throw new RuntimePolicyManagementError('conflict');
    return this.view(result.snapshot, runtime);
  }
}
