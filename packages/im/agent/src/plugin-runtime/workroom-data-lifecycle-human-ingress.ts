import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type {
  HumanIngressTypedControlDecision,
  HumanIngressTypedControlInput,
  HumanIngressTypedControlPort,
} from '../workroom/human-ingress-orchestrator.js';
import type {
  WorkroomDataLifecycleConsoleCommand,
  WorkroomDataLifecycleConsoleControlPort,
  WorkroomDataLifecycleConsoleExecuteResult,
} from './workroom-data-lifecycle-console.js';

export interface CreateWorkroomDataLifecycleHumanIngressControlOptions {
  /** Resolve the current generation-owned Root-authorized control on every application. */
  readonly resolve: () => WorkroomDataLifecycleConsoleControlPort | undefined;
  readonly generationSignal: AbortSignal;
  /** Existing strict control grammar, normally the Plan Gate adapter. */
  readonly fallback?: HumanIngressTypedControlPort;
}

/**
 * Strict Sponsor Room adapter. Message text is parsed transiently; Project,
 * principal and operation identity always come from the exact Human Ingress request.
 */
export function createWorkroomDataLifecycleHumanIngressControlPort(
  options: CreateWorkroomDataLifecycleHumanIngressControlOptions,
): HumanIngressTypedControlPort {
  return Object.freeze({
    async apply(input: HumanIngressTypedControlInput): Promise<HumanIngressTypedControlDecision> {
      options.generationSignal.throwIfAborted();
      if (!/^\/control\s+data-lifecycle(?:\s|$)/iu.test(input.text.trim())) {
        return options.fallback
          ? await options.fallback.apply(input)
          : clarification('missing_control_target');
      }
      if (input.authorityRequirement !== 'typed_sponsor_control') {
        return clarification('unauthorized_control');
      }
      const command = parseDataLifecycleSponsorCommand(input);
      if (!command) return clarification('missing_control_target');
      const control = options.resolve();
      if (!control) return clarification('unauthorized_control');
      const result = await control.execute(
        command,
        { principalId: requiredText(input.principalId, 'Human ingress principal') },
        options.generationSignal,
      );
      options.generationSignal.throwIfAborted();
      if (result.status === 'forbidden') return clarification('unauthorized_control');
      if (result.status === 'stale') return clarification('stale_target');
      if (result.status === 'unavailable') return clarification('missing_control_target');
      return contentFreeReceipt(input, command.kind, result);
    },
  });
}

function parseDataLifecycleSponsorCommand(
  input: HumanIngressTypedControlInput,
): WorkroomDataLifecycleConsoleCommand | null {
  let text = input.text.trim();
  const scoped = /^\/control\s+data-lifecycle\s+project\s+(\S+)\s+(.+)$/iu.exec(text);
  if (scoped) {
    if (scoped[1] !== input.projectId) return null;
    text = `/control data-lifecycle ${scoped[2]}`;
  } else {
    return null;
  }
  const common = {
    operationId: requiredText(input.operationId, 'Human ingress operation'),
    projectId: requiredText(input.projectId, 'Human ingress Project'),
  };
  let match = /^\/control\s+data-lifecycle\s+hold\s+place\s+(\S+)\s+(\S+)\s+(legal_hold|investigation|regulatory_preservation)\s+(\d+)$/iu.exec(text);
  if (match) {
    const reviewAt = safeInteger(match[4]);
    if (reviewAt === undefined) return null;
    return deepFreeze({ kind: 'place_hold', ...common, objectId: match[1]!, holdId: match[2]!,
      reasonCode: match[3]!.toLowerCase() as 'legal_hold' | 'investigation' | 'regulatory_preservation', reviewAt });
  }
  match = /^\/control\s+data-lifecycle\s+hold\s+review\s+(\S+)\s+(\S+)\s+(approve|reject)$/iu.exec(text);
  if (match) {
    return deepFreeze({ kind: 'review_hold', ...common, objectId: match[1]!, holdId: match[2]!,
      approved: match[3]!.toLowerCase() === 'approve' });
  }
  match = /^\/control\s+data-lifecycle\s+hold\s+release\s+(\S+)\s+(\S+)$/iu.exec(text);
  if (match) {
    return deepFreeze({ kind: 'release_hold', ...common, objectId: match[1]!, holdId: match[2]! });
  }
  match = /^\/control\s+data-lifecycle\s+erasure\s+request\s+(\S+)\s+(\S+)$/iu.exec(text);
  if (match) {
    return deepFreeze({ kind: 'request_subject_erasure', ...common,
      tenantId: match[1]!, subjectRef: match[2]! });
  }
  match = /^\/control\s+data-lifecycle\s+export\s+subject\s+(\S+)\s+(\S+)\s+(\d+)$/iu.exec(text);
  if (match) {
    const deadline = safeInteger(match[3]);
    if (deadline === undefined) return null;
    return deepFreeze({ kind: 'export_subject', ...common,
      tenantId: match[1]!, subjectRef: match[2]!, deadline });
  }
  return null;
}

function contentFreeReceipt(
  input: HumanIngressTypedControlInput,
  action: WorkroomDataLifecycleConsoleCommand['kind'],
  result: Extract<WorkroomDataLifecycleConsoleExecuteResult, { status: 'ready' }>,
): HumanIngressTypedControlDecision {
  const operationDigest = digest({ operationId: input.operationId });
  const receiptRef = `workroom-data-lifecycle:${operationDigest}`;
  const resultDigest = 'export' in result ? result.export.auditReceiptDigest
    : 'projection' in result ? result.projection.digest
      : digest(result.projections.map(projection => projection.digest));
  return deepFreeze({
    status: 'authorized' as const,
    receiptRef,
    receiptDigest: digest({
      version: 1,
      kind: 'data_lifecycle_sponsor_control',
      action,
      operationDigest,
      projectId: input.projectId,
      sourceDigest: input.source.digest,
      principalDigest: digest({ principalId: input.principalId }),
      resultDigest,
    }),
  });
}

function clarification(
  reason: 'missing_control_target' | 'unauthorized_control' | 'stale_target',
): HumanIngressTypedControlDecision {
  return deepFreeze({ status: 'clarification_required' as const, reason, candidateRefs: [] });
}

function requiredText(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function safeInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
