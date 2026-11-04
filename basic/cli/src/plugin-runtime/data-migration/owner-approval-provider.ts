import type { OwnerApprovalRuntime } from '@zhin.js/agent/security';
import { DataMigrationError, generationAdmissionSource, type GenerationAdmissionGate,
  type PluginDataMigrationProvider } from '@zhin.js/plugin-runtime';

/** Approval history can be inspected, but never activated by a data binding operation. */
export function createOwnerApprovalMigrationProvider(input: Readonly<{
  approvals: Pick<OwnerApprovalRuntime, 'previewHistoricalApprovals'>;
  admission: GenerationAdmissionGate;
}>): PluginDataMigrationProvider {
  const requiresAuthorization = async (): Promise<never> => {
    throw new DataMigrationError('unsupported', 'Historical grants require fresh authorization through the current Owner approval flow');
  };
  return Object.freeze({
    title: 'Owner approval history',
    get [generationAdmissionSource]() { return [input.admission]; },
    async preview(request) { request?.signal?.throwIfAborted(); return input.approvals.previewHistoricalApprovals(); },
    prepare: requiresAuthorization, apply: requiresAuthorization, inspect: requiresAuthorization,
    resume: requiresAuthorization, restore: requiresAuthorization,
  } satisfies PluginDataMigrationProvider);
}
