import type { WorkroomJournal } from '../workroom/journal.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type { WorkflowPlanProposal } from '../workroom/workflow-plan-builder.js';
import type {
  WorkroomRunProfilePinAuthority,
  WorkroomRunProfilePinAuthorityPort,
  WorkroomRunProfilePinPort,
  WorkroomRunProfilePinRequest,
} from './workroom-profile-authority-runtime.js';
import type { ProjectProfileRegistry } from '../workroom/profile-registry.js';
import type { WorkroomPlanAdmissionReceipt } from '../workroom/workroom-kernel.js';

export const WORKROOM_KERNEL_PLAN_ADMISSION_PRINCIPAL = 'kernel:plan-admission';

export interface WorkroomPlanAdmissionProfilePinInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly plan: WorkflowPlanProposal;
  readonly receipt: WorkroomPlanAdmissionReceipt;
}

/** Exact immutable authority derived only from persisted Kernel admission facts. */
export class JournalWorkroomRunProfilePinAuthority implements WorkroomRunProfilePinAuthorityPort {
  constructor(readonly options: Readonly<{
    generation: number;
    journal: Pick<WorkroomJournal, 'read'>;
  }>) {
    positive(options.generation, 'Run pin authority generation');
  }

  async commandFor(
    input: WorkroomPlanAdmissionProfilePinInput,
    expectedRegistryRevision: number,
  ): Promise<Omit<WorkroomRunProfilePinRequest, 'generation' | 'digest'>> {
    const facts = await this.#facts(input.receipt.runId);
    if (facts.projectId !== input.projectId || facts.planRevisionId !== input.plan.proposalId
      || facts.planDigest !== input.plan.digest
      || facts.profileRevisionId !== input.plan.authority.profileRevisionId
      || facts.profileDigest !== input.plan.authority.profileDigest) {
      throw new Error('Kernel Plan admission fact does not match the requested Run Profile pin');
    }
    return deepFreeze({
      version: 1,
      operationId: required(input.operationId, 'Run pin operation id'),
      principalId: WORKROOM_KERNEL_PLAN_ADMISSION_PRINCIPAL,
      projectId: input.projectId,
      runId: input.receipt.runId,
      planRevisionId: facts.planRevisionId,
      planDigest: facts.planDigest,
      profileRevisionId: facts.profileRevisionId,
      profileDigest: facts.profileDigest,
      runFactDigest: facts.runFactDigest,
      expectedRegistryRevision,
    });
  }

  async authorize(request: WorkroomRunProfilePinRequest): Promise<WorkroomRunProfilePinAuthority | undefined> {
    if (request.generation !== this.options.generation
      || request.principalId !== WORKROOM_KERNEL_PLAN_ADMISSION_PRINCIPAL) return undefined;
    const facts = await this.#facts(request.runId);
    if (facts.projectId !== request.projectId || facts.planRevisionId !== request.planRevisionId
      || facts.planDigest !== request.planDigest
      || facts.profileRevisionId !== request.profileRevisionId
      || facts.profileDigest !== request.profileDigest
      || facts.runFactDigest !== request.runFactDigest) return undefined;
    return deepFreeze({
      requestDigest: request.digest,
      authorityDigest: digest({
        version: 1,
        generation: this.options.generation,
        principalId: WORKROOM_KERNEL_PLAN_ADMISSION_PRINCIPAL,
        requestDigest: request.digest,
        facts,
      }),
    });
  }

  async verify(
    request: WorkroomRunProfilePinRequest,
    authority: WorkroomRunProfilePinAuthority,
  ): Promise<boolean> {
    const expected = await this.authorize(request);
    return expected !== undefined && canonicalWorkroomJson(expected) === canonicalWorkroomJson(authority);
  }

  async #facts(runId: string) {
    const events = await this.options.journal.read(required(runId, 'Run pin Run id'));
    const created = events.filter(event => event.type === 'run.created');
    const admitted = events.filter(event => event.type === 'plan.admitted');
    if (created.length !== 1 || admitted.length !== 1) {
      throw new Error('Run Profile pin requires one exact persisted Kernel Plan admission');
    }
    const run = created[0]!;
    const planEvent = admitted[0]!;
    const plan = planEvent.payload.plan as WorkflowPlanProposal | undefined;
    if (!plan || planEvent.payload.operationId !== plan.proposalId) {
      throw new Error('Persisted Kernel Plan admission payload is malformed');
    }
    const projectId = required(run.payload.projectId, 'Kernel Run fact Project id');
    const planRevisionId = required(plan.proposalId, 'Kernel Plan revision id');
    const planDigest = requiredDigest(plan.digest, 'Kernel Plan digest');
    const profileRevisionId = required(plan.authority.profileRevisionId, 'Kernel Plan Profile revision id');
    const profileDigest = requiredDigest(plan.authority.profileDigest, 'Kernel Plan Profile digest');
    const factBody = deepFreeze({
      version: 1 as const,
      runId,
      projectId,
      runCreated: { sequence: run.sequence, digest: digest(run) },
      planAdmitted: { sequence: planEvent.sequence, digest: digest(planEvent) },
      planRevisionId,
      planDigest,
      profileRevisionId,
      profileDigest,
    });
    return deepFreeze({ ...factBody, runFactDigest: digest(factBody) });
  }
}

/** Post-admission writer. Retry replays the same Kernel facts and Profile pin CAS. */
export class KernelPlanAdmissionRunProfilePinWriter {
  constructor(readonly options: Readonly<{
    authority: JournalWorkroomRunProfilePinAuthority;
    profiles: Pick<ProjectProfileRegistry, 'read'>;
    runPins: WorkroomRunProfilePinPort;
  }>) {}

  async afterPlanAdmission(
    input: WorkroomPlanAdmissionProfilePinInput,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const profiles = await this.options.profiles.read(input.projectId);
    if (!profiles.active
      || profiles.active.revisionId !== input.plan.authority.profileRevisionId
      || profiles.active.compiledDigest !== input.plan.authority.profileDigest) {
      throw new Error('Kernel Plan admission Profile authority is no longer the active pin candidate');
    }
    const command = await this.options.authority.commandFor(input, profiles.registryRevision);
    await this.options.runPins.pin(command, signal);
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  const canonical = required(value, label);
  if (!/^sha256:[a-f0-9]{64}$/.test(canonical)) throw new Error(`${label} is invalid`);
  return canonical;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid`);
  return value;
}
