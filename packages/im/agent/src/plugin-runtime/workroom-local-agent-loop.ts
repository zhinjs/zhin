import { createToken } from '@zhin.js/plugin-runtime';
import type { DeferredCapabilityPlan } from './deferred-capability-plan.js';
import type {
  LocalModelExecutionPort,
  LocalModelExecutionRequest,
} from '../workroom/local-assignment-executor.js';
import {
  createWorkroomEvidence,
  createWorkroomStructuredTaskReport,
  WorkroomGovernedPayloadHeaderCasLostError,
  type WorkroomGovernedPayloadPublicationPort,
  type WorkroomGovernedPayloadReceipt,
  type WorkroomTaskReportPayloadPort,
  type WorkroomTaskReportStore,
} from '../workroom/workroom-task-report-store.js';
import { digestCanonicalWorkroomValue as digest } from '../workroom/canonical-value.js';

export interface WorkroomLocalTurnJournalAttribution {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly attempt: number;
  readonly fence: number;
}

export interface WorkroomLocalAgentTurnInput {
  readonly sessionId: string;
  readonly turnId: string;
  readonly principalId: string;
  readonly agentDefinitionId?: string;
  readonly workspaceRoot: string;
  readonly journalAttribution: WorkroomLocalTurnJournalAttribution;
  readonly prompt: string;
  readonly capabilityPlan: DeferredCapabilityPlan;
}

export interface WorkroomLocalAgentTurnResult {
  readonly output: string;
}

export interface WorkroomEvidencePayloadWriteInput {
  readonly mediaType: string;
  readonly content: string;
  /** Untrusted model assertion. The writer must resolve/verify a canonical source independently. */
  readonly claimedSource: WorkroomEvidenceClaimedSource;
  readonly attribution: WorkroomLocalTurnJournalAttribution;
  readonly publication: WorkroomGovernedPayloadPublicationPort;
}

/** Content-free receipt returned by the governed Payload Vault boundary. */
export interface WorkroomEvidencePayloadReceipt extends WorkroomGovernedPayloadReceipt {}

export interface WorkroomEvidenceClaimedSource {
  readonly kind: 'command' | 'file' | 'url' | 'tool' | 'human';
  readonly locator: string;
}

/** Stable narrow port; P12 storage implementations adapt to this boundary. */
export interface WorkroomEvidencePayloadWriterPort {
  write(
    input: WorkroomEvidencePayloadWriteInput,
    signal: AbortSignal,
  ): Promise<WorkroomEvidencePayloadReceipt>;
}

export const workroomEvidencePayloadWriterToken = createToken<WorkroomEvidencePayloadWriterPort>(
  'zhin.agent.workroom-evidence-payload-writer',
  'Generation-owned governed Payload Vault writer for Workroom evidence bodies',
);

export const workroomTaskReportPayloadToken = createToken<WorkroomTaskReportPayloadPort>(
  'zhin.agent.workroom-task-report-payload',
  'Generation-owned governed Payload Vault read/write authority for structured Task Reports',
);

/** Narrow production seam adapted to ZhinAgent's AgentCore/agentLoop. */
export interface WorkroomLocalAgentTurnPort {
  run(
    input: WorkroomLocalAgentTurnInput,
    signal: AbortSignal,
  ): Promise<WorkroomLocalAgentTurnResult>;
}

export interface DurableReportLocalModelExecutionPortOptions {
  readonly turn: WorkroomLocalAgentTurnPort;
  readonly reports: WorkroomTaskReportStore;
  readonly payloads: WorkroomEvidencePayloadWriterPort;
  readonly readPrompt?: (request: LocalModelExecutionRequest) => string | Promise<string>;
}

interface LocalTaskReportEvidenceOutput {
  readonly id: string;
  readonly mediaType: string;
  readonly content: string;
  readonly source: WorkroomEvidenceClaimedSource;
}

interface LocalTaskReportOutput {
  readonly claims: readonly Readonly<{
    label: string;
    key: string;
    value: string;
    status: 'verified' | 'assumed';
    evidenceIds: readonly string[];
    artifactRefs: readonly string[];
    validUntil?: number;
    supersedesFactIds?: readonly string[];
  }>[];
  readonly evidence: readonly Readonly<LocalTaskReportEvidenceOutput>[];
}

/** Persists content-addressed evidence/report before completion can escape. */
export class DurableReportLocalModelExecutionPort implements LocalModelExecutionPort {
  constructor(readonly options: DurableReportLocalModelExecutionPortOptions) {}

  async *execute(request: LocalModelExecutionRequest, signal: AbortSignal) {
    signal.throwIfAborted();
    const envelope = request.envelope;
    const attribution = Object.freeze({
      projectId: envelope.projectId,
      runId: envelope.runId,
      taskKey: envelope.taskKey,
      taskRevision: envelope.taskRevision,
      assignmentId: envelope.assignmentId,
      attempt: envelope.attempt,
      fence: envelope.fence,
    });
    const identity = `${envelope.projectId}:${envelope.runId}:${envelope.assignmentId}:${envelope.attempt}:${envelope.fence}`;
    yield Object.freeze({
      version: 1 as const,
      type: 'heartbeat' as const,
      eventId: 'turn-admitted',
    });
    const result = await this.options.turn.run(Object.freeze({
      sessionId: `workroom:${identity}`,
      turnId: `workroom-turn:${envelope.assignmentId}:${envelope.attempt}:${envelope.fence}`,
      principalId: envelope.principalId,
      ...(request.agentDefinitionId === undefined
        ? {}
        : { agentDefinitionId: request.agentDefinitionId }),
      workspaceRoot: envelope.workspace.mountRef,
      journalAttribution: attribution,
      prompt: await this.#prompt(request),
      capabilityPlan: request.capabilityPlan,
    }), signal);
    signal.throwIfAborted();
    yield Object.freeze({
      version: 1 as const,
      type: 'progress' as const,
      eventId: 'model-turn-completed',
      progress: Object.freeze({ summary: 'Local Agent loop produced a structured Task Report' }),
    });
    const output = parseReportOutput(result.output);
    const evidenceById = new Map<string, Readonly<{ ref: string; verified: boolean }>>();
    for (const item of output.evidence) {
      signal.throwIfAborted();
      let publishedEvidence: ReturnType<typeof createWorkroomEvidence> | undefined;
      const payload = validatePayloadReceipt(await this.options.payloads.write(Object.freeze({
        mediaType: item.mediaType,
        content: item.content,
        claimedSource: item.source,
        attribution,
        publication: Object.freeze({
          publish: async (
            candidate: WorkroomEvidencePayloadReceipt,
            publicationSignal: AbortSignal,
          ) => {
            publicationSignal.throwIfAborted();
            const governed = validatePayloadReceipt(candidate);
            const evidence = createWorkroomEvidence({
              mediaType: item.mediaType,
              descriptor: governed.descriptor,
              source: governed.source,
            });
            const header = await this.options.reports.writeEvidence(evidence);
            if (header.ref !== evidence.ref || header.digest !== evidence.digest) {
              throw new WorkroomGovernedPayloadHeaderCasLostError(
                'Workroom Evidence header CAS winner drift',
              );
            }
            publishedEvidence = evidence;
            return Object.freeze({ publicationDigest: header.digest });
          },
        }),
      }), signal));
      signal.throwIfAborted();
      const evidence = publishedEvidence;
      if (!evidence) {
        throw new Error('Governed Workroom Evidence Writer did not publish the durable header');
      }
      if (JSON.stringify(evidence.descriptor) !== JSON.stringify(payload.descriptor)
        || JSON.stringify(evidence.source) !== JSON.stringify(payload.source)) {
        throw new Error('Governed Workroom Evidence publication receipt drift');
      }
      evidenceById.set(item.id, Object.freeze({
        ref: evidence.ref,
        verified: evidence.source.verification === 'verified',
      }));
    }
    const report = createWorkroomStructuredTaskReport({
      projectId: envelope.projectId,
      runId: envelope.runId,
      planRef: envelope.plan.ref,
      planRevision: envelope.plan.revision,
      taskKey: envelope.taskKey,
      taskRevision: envelope.taskRevision,
      assignmentId: envelope.assignmentId,
      assignmentAttempt: envelope.attempt,
      assignmentFence: envelope.fence,
      claims: output.claims.map((claim, claimOrdinal) => ({
        label: claim.label,
        key: claim.key,
        value: claim.value,
        status: claim.status,
        evidenceRefs: claim.evidenceIds.map(id => {
          const evidence = evidenceById.get(id);
          if (!evidence) throw new Error(`Structured Task Report references unknown evidence id ${id}`);
          if (claim.status === 'verified' && !evidence.verified) {
            throw new Error(`Verified claim at ordinal ${claimOrdinal} references unverified evidence ${id}`);
          }
          return evidence.ref;
        }),
        artifactRefs: claim.artifactRefs,
        ...(claim.validUntil === undefined ? {} : { validUntil: claim.validUntil }),
        ...(claim.supersedesFactIds === undefined
          ? {}
          : { supersedesFactIds: claim.supersedesFactIds }),
      })),
    });
    signal.throwIfAborted();
    const reportReceipt = await this.options.reports.writeReport(report);
    const candidate = Object.freeze({
      ref: `workroom-candidate:${report.candidateHash}`,
      hash: report.candidateHash,
    });
    const completionReceiptDigest = digest({
      version: 1,
      envelopeDigest: envelope.digest,
      report: reportReceipt,
      candidate,
    });
    signal.throwIfAborted();
    yield Object.freeze({
      version: 1 as const,
      type: 'execution_completed' as const,
      eventId: 'durable-report-published',
      completion: Object.freeze({
        report: reportReceipt,
        candidate,
        completionReceiptDigest,
      }),
    });
  }

  async #prompt(request: LocalModelExecutionRequest): Promise<string> {
    if (this.options.readPrompt) return await this.options.readPrompt(request);
    return [
      `Execute Workroom Task ${request.envelope.taskKey}@${request.envelope.taskRevision}.`,
      `Workspace mount: ${request.envelope.workspace.mountRef}.`,
      ...structuredTaskReportPrompt(),
      'Do not use chat Subagent lifecycle or emit Task status commands.',
    ].join('\n');
  }
}

export function structuredTaskReportPrompt(): readonly string[] {
  return Object.freeze([
    'Return exactly one JSON object, with no Markdown fence or prose before or after it.',
    'The only permitted top-level keys are "claims" and "evidence". Never add task_id, taskId, taskKey, status, summary, or other metadata.',
    'Each claims[] item must use exactly: label, key, value, status, evidenceIds, artifactRefs; optional keys are validUntil and supersedesFactIds. Use [] for empty evidenceIds and artifactRefs.',
    'Each evidence[] item must use exactly: id, mediaType, content, source. Each source must use exactly: kind and locator; kind is command, file, url, tool, or human.',
    'The Host owns Task/Assignment identity and canonical claimId. Do not repeat those fields. A verified claim must reference verified evidenceIds; otherwise use status "assumed".',
    'Required shape: {"claims":[{"label":"result","key":"task.result","value":"...","status":"assumed","evidenceIds":[],"artifactRefs":[]}],"evidence":[]}',
  ]);
}

function parseReportOutput(serialized: string): LocalTaskReportOutput {
  let value: unknown;
  try {
    value = JSON.parse(stripFence(serialized));
  } catch (error) {
    throw new Error('Local Agent loop must return structured Task Report JSON', { cause: error });
  }
  const record = requireRecord(value, 'Task Report');
  exactKeys(record, ['claims', 'evidence'], 'Task Report');
  if (!Array.isArray(record.claims) || !Array.isArray(record.evidence)) {
    throw new Error('Local Agent loop structured Task Report JSON requires claims and evidence arrays');
  }
  const evidenceIds = new Set<string>();
  const evidence = record.evidence.map((item, index) => {
    const entry = requireRecord(item, `evidence[${index}]`);
    exactKeys(entry, ['id', 'mediaType', 'content', 'source'], `evidence[${index}]`);
    const id = text(entry.id, `evidence[${index}].id`);
    if (evidenceIds.has(id)) throw new Error(`Duplicate structured Task Report evidence id ${id}`);
    evidenceIds.add(id);
    const source = requireRecord(entry.source, `evidence[${index}].source`);
    exactKeys(source, ['kind', 'locator'], `evidence[${index}].source`);
    return Object.freeze({
      id,
      mediaType: text(entry.mediaType, `evidence[${index}].mediaType`),
      content: text(entry.content, `evidence[${index}].content`),
      source: Object.freeze({
        kind: evidenceKind(source.kind),
        locator: text(source.locator, `evidence[${index}].source.locator`),
      }),
    });
  });
  const claimLabels = new Set<string>();
  const claims = record.claims.map((item, index) => {
    const claim = requireRecord(item, `claims[${index}]`);
    exactKeys(claim, [
      'label', 'key', 'value', 'status', 'evidenceIds', 'artifactRefs',
      'validUntil', 'supersedesFactIds',
    ], `claims[${index}]`);
    const label = text(claim.label, `claims[${index}].label`);
    if (claimLabels.has(label)) throw new Error('Structured Task Report contains duplicate claim labels');
    claimLabels.add(label);
    if (claim.status !== 'verified' && claim.status !== 'assumed') {
      throw new Error(`Structured Task Report claims[${index}].status is invalid`);
    }
    return Object.freeze({
      label,
      key: text(claim.key, `claims[${index}].key`),
      value: text(claim.value, `claims[${index}].value`),
      status: claim.status,
      evidenceIds: textArray(claim.evidenceIds, `claims[${index}].evidenceIds`),
      artifactRefs: textArray(claim.artifactRefs, `claims[${index}].artifactRefs`),
      ...(claim.validUntil === undefined
        ? {}
        : { validUntil: nonNegative(claim.validUntil, `claims[${index}].validUntil`) }),
      ...(claim.supersedesFactIds === undefined
        ? {}
        : { supersedesFactIds: textArray(claim.supersedesFactIds, `claims[${index}].supersedesFactIds`) }),
    });
  });
  return Object.freeze({ claims: Object.freeze(claims), evidence: Object.freeze(evidence) });
}

function stripFence(value: string): string {
  const text = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(text);
  return match?.[1] ?? text;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Structured ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra) throw new Error(`Structured ${label} contains forbidden field ${extra}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Structured Task Report ${label} requires canonical text`);
  }
  return value;
}

function textArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`Structured Task Report ${label} must be an array`);
  const values = value.map(item => text(item, label));
  if (new Set(values).size !== values.length) {
    throw new Error(`Structured Task Report ${label} contains duplicates`);
  }
  return Object.freeze(values);
}

function nonNegative(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Structured Task Report ${label} must be a non-negative safe integer`);
  }
  return Number(value);
}

function evidenceKind(value: unknown): WorkroomEvidenceClaimedSource['kind'] {
  if (!['command', 'file', 'url', 'tool', 'human'].includes(String(value))) {
    throw new Error('Structured Task Report evidence source kind is invalid');
  }
  return value as WorkroomEvidenceClaimedSource['kind'];
}

function validatePayloadReceipt(value: WorkroomEvidencePayloadReceipt): WorkroomEvidencePayloadReceipt {
  if (!value || typeof value !== 'object') {
    throw new Error('Workroom Evidence Payload Writer returned no receipt');
  }
  const descriptor = value.descriptor;
  const source = value.source;
  const canonicalDigest = (candidate: unknown, label: string) => {
    if (typeof candidate !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(candidate)) {
      throw new Error(`Workroom Evidence Payload Writer returned invalid ${label}`);
    }
    return candidate;
  };
  if (!descriptor || !source) {
    throw new Error('Workroom Evidence Payload Writer returned an incomplete receipt');
  }
  if (source.verification !== 'verified' && source.verification !== 'unverified') {
    throw new Error('Workroom Evidence Payload Writer returned invalid source verification');
  }
  if (!['command', 'file', 'url', 'tool', 'human'].includes(source.kind)) {
    throw new Error('Workroom Evidence Payload Writer returned invalid canonical source kind');
  }
  return Object.freeze({
    descriptor: Object.freeze({
      vaultObjectId: text(descriptor.vaultObjectId, 'payload receipt vaultObjectId'),
      objectId: text(descriptor.objectId, 'payload receipt objectId'),
      payloadHash: canonicalDigest(descriptor.payloadHash, 'payloadHash'),
      descriptorDigest: canonicalDigest(descriptor.descriptorDigest, 'descriptorDigest'),
      locationManifestDigest: canonicalDigest(
        descriptor.locationManifestDigest,
        'locationManifestDigest',
      ),
      bytes: nonNegative(descriptor.bytes, 'payload receipt bytes'),
    }),
    source: Object.freeze({
      kind: source.kind,
      ref: text(source.ref, 'payload receipt canonical source ref'),
      digest: canonicalDigest(source.digest, 'source digest'),
      bindingDigest: canonicalDigest(source.bindingDigest, 'source binding digest'),
      verification: source.verification,
    }),
  });
}
