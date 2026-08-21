import type { GovernedDisclosureBlockReason } from './workroom-data-governance-runtime.js';

export type WorkroomGovernedDispatchRecoveryAction =
  | 'rematerialize'
  | 'operator_repair'
  | 'authority_repair'
  | 'new_generation';

export interface WorkroomGovernedDispatchReason {
  readonly version: 1;
  readonly code: GovernedDisclosureBlockReason;
  readonly retryable: boolean;
  readonly action: WorkroomGovernedDispatchRecoveryAction;
}

const reasons = Object.freeze<Record<GovernedDisclosureBlockReason, Readonly<{
  retryable: boolean;
  action: WorkroomGovernedDispatchRecoveryAction;
}>>>({
  project_authority_unavailable: { retryable: true, action: 'authority_repair' },
  payload_vault_key_unavailable: { retryable: true, action: 'operator_repair' },
  source_classification_quarantined: { retryable: false, action: 'authority_repair' },
  source_authority_conflict: { retryable: false, action: 'rematerialize' },
  disclosure_denied: { retryable: false, action: 'authority_repair' },
  disclosure_approval_required: { retryable: false, action: 'rematerialize' },
  disclosure_manifest_stale: { retryable: false, action: 'rematerialize' },
  disclosure_manifest_expired: { retryable: false, action: 'rematerialize' },
  disclosure_recipient_revoked: { retryable: false, action: 'rematerialize' },
  generation_retired: { retryable: false, action: 'new_generation' },
});

export function createWorkroomGovernedDispatchReason(
  value: string,
): WorkroomGovernedDispatchReason {
  if (!Object.hasOwn(reasons, value)) {
    throw new Error('Workroom governed dispatch reason is unknown');
  }
  const code = value as GovernedDisclosureBlockReason;
  return Object.freeze({ version: 1, code, ...reasons[code] });
}
