import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DurableFileStore } from '../workroom/durable-file-store.js';
import { createToken } from '@zhin.js/plugin-runtime';
import { digestCanonicalWorkroomValue as digest } from '../workroom/canonical-value.js';
import { createSoftwareDeliveryPlan, type SoftwareDeliveryPlanInput } from '../workroom/software-delivery-plan.js';
import type { WorkroomKernel } from '../workroom/workroom-kernel.js';

/** Host-owned identity and policy. Never populate these from Issue text or comments. */
export interface SelfDeliveryRepoProfile {
  readonly repository: 'zhinjs/zhin';
  readonly repositoryId: number;
  readonly projectId: string;
  readonly revision: string;
  readonly sponsorPrincipalIds: readonly string[];
}
export interface SelfDeliveryIssue {
  readonly repositoryId: number;
  readonly number: number;
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly updatedAt: string;
  readonly state: 'open' | 'closed';
}
export interface SelfDeliveryProjectPorts {
  readonly profile: SelfDeliveryRepoProfile;
  readonly kernel: Pick<WorkroomKernel, 'admitWorkflowPlan' | 'readWorkflowPlanAdmission'>;
  /** Must recheck current membership; caller-controlled strings are not authentication. */
  authenticate(input: unknown): Promise<{ principalId: string } | undefined>;
  readIssue(number: number): Promise<SelfDeliveryIssue>;
  /** Trusted Catalog/Profile authority supplies roles, budgets and immutable policy pins. */
  planInput(input: { operationId: string; issue: SelfDeliveryIssue; principalId: string }): Promise<Omit<SoftwareDeliveryPlanInput, 'request' | 'acceptanceCriteria' | 'repositoryId'>>;
  /** Performs live connection/permission and installed executor/provider checks. */
  readiness(): Promise<readonly string[]>;
}
export const selfDeliveryProjectToken = createToken<SelfDeliveryProject>('zhin.self-delivery.project');
interface Selection {
  readonly version: 1;
  readonly profileDigest: string;
  readonly principalId: string;
  readonly issue: SelfDeliveryIssue;
  readonly acceptanceCriteria: readonly string[];
  readonly planInput: Omit<SoftwareDeliveryPlanInput, 'request' | 'acceptanceCriteria' | 'repositoryId'>;
}

/** Issue mapping only. Kernel Journal remains the sole Run/Task state authority. */
export class SelfDeliveryProject {
  readonly #directory: string;
  readonly #ports?: SelfDeliveryProjectPorts;
  constructor(directory: string, ports?: SelfDeliveryProjectPorts) {
    this.#directory = directory;
    this.#ports = ports;
    if (ports && (ports.profile.repository !== 'zhinjs/zhin' || !Number.isSafeInteger(ports.profile.repositoryId)
      || ports.profile.repositoryId <= 0 || !ports.profile.projectId.trim() || !ports.profile.revision.trim()
      || !ports.profile.sponsorPrincipalIds.length)) throw new Error('Invalid self-delivery repository profile');
  }
  async doctor(): Promise<{ configured: boolean; ready: boolean; blockers: readonly string[] }> {
    if (!this.#ports) return { configured: false, ready: false, blockers: ['Trusted project ports are not installed'] };
    try {
      const blockers = await this.#ports.readiness();
      return { configured: true, ready: blockers.length === 0, blockers: [...blockers] };
    } catch {
      return { configured: true, ready: false, blockers: ['Live readiness probe failed'] };
    }
  }
  async select(input: { identity: unknown; issueNumber: number; acceptanceCriteria: readonly string[] }) {
    const ports = this.#ports;
    if (!ports) throw new Error('Self-delivery project is not configured');
    const identity = await ports.authenticate(input.identity);
    if (!identity || !ports.profile.sponsorPrincipalIds.includes(identity.principalId)) throw new Error('Issue selection requires an authenticated project Sponsor');
    if (!Number.isSafeInteger(input.issueNumber) || input.issueNumber <= 0) throw new Error('Invalid Issue number');
    const criteria = input.acceptanceCriteria.map(value => value.trim());
    if (!criteria.length || criteria.some(value => !value) || criteria.length > 32 || criteria.some(value => value.length > 8192)) throw new Error('Explicit bounded acceptance criteria are required');
    const operationId = `self-delivery:${ports.profile.repositoryId}:issue:${input.issueNumber}`;
    const file = join(this.#directory, `${digest(operationId).slice(7)}.json`);
    const store = new DurableFileStore(this.#directory);
    await store.ensureDurableLeaf('Self-delivery Issue snapshots');
    let selection = await readSelection(file);
    if (!selection) {
      const readiness = await this.doctor();
      if (!readiness.ready) throw new Error(`Self-delivery blocked: ${readiness.blockers.join('; ')}`);
      const issue = await ports.readIssue(input.issueNumber);
      if (issue.repositoryId !== ports.profile.repositoryId || issue.number !== input.issueNumber || issue.state !== 'open'
        || !Number.isSafeInteger(issue.id) || issue.id <= 0 || !issue.title.trim() || issue.body.length > 262144) throw new Error('Issue does not match the admitted repository scope');
      const planInput = await ports.planInput({ operationId, issue, principalId: identity.principalId });
      if (planInput.metadata.proposalId !== operationId || planInput.metadata.projectId !== ports.profile.projectId || planInput.sponsor.principalId !== identity.principalId) throw new Error('Planning authority scope mismatch');
      selection = { version: 1, profileDigest: digest(ports.profile), principalId: identity.principalId, issue, acceptanceCriteria: criteria, planInput };
      // Validate before persisting. Exclusive creation makes concurrent selections converge.
      planFor(selection);
      selection = (await store.publishCreateOnly({ target: file,
        content: JSON.stringify({ selection, digest: digest(selection) }), createdValue: selection,
        onConflict: async () => {
          const existing = await readSelection(file);
          if (!existing) throw new Error('Issue selection disappeared');
          return existing;
        },
      })).value;
    }
    if (selection.profileDigest !== digest(ports.profile)) throw new Error('Persisted Issue profile changed; explicit migration is required');
    if (digest(selection.acceptanceCriteria) !== digest(criteria)) throw new Error('Issue already selected with different criteria; use governed plan revision');
    const plan = planFor(selection);
    const requestDigest = digest(selection.issue);
    const sourceEventRef = `github:zhinjs/zhin/issues/${selection.issue.number}@${requestDigest}`;
    // Exact Kernel admission is idempotent even after a crash between Journal and response.
    const currentIdentity = await ports.authenticate(input.identity);
    if (!currentIdentity || currentIdentity.principalId !== identity.principalId
      || !ports.profile.sponsorPrincipalIds.includes(currentIdentity.principalId)) throw new Error('Issue selection authority expired or was revoked');
    const receipt = await ports.kernel.admitWorkflowPlan({ operationId, projectId: ports.profile.projectId,
      title: selection.issue.title, sourceEventRef, sourceEventDigest: requestDigest,
      orchestratorAgentDefinitionId: plan.authority.orchestratorAgentDefinitionId, plan });
    return { issueNumber: selection.issue.number, issueDigest: requestDigest, runId: receipt.runId,
      receiptRef: receipt.receiptRef, planDigest: plan.digest };
  }
}
function planFor(selection: Selection) {
  return createSoftwareDeliveryPlan({ ...selection.planInput, repositoryId: 'github:zhinjs/zhin',
    request: { ref: `github:zhinjs/zhin/issues/${selection.issue.number}`, digest: digest(selection.issue) },
    acceptanceCriteria: selection.acceptanceCriteria.map((text, index) => ({ ref: `issue:${selection.issue.id}:criterion:${index}`, digest: digest(text) })),
  });
}
async function readSelection(file: string): Promise<Selection | undefined> {
  try {
    const record = JSON.parse(await readFile(file, 'utf8')) as { selection: Selection; digest: string };
    if (record.selection?.version !== 1 || digest(record.selection) !== record.digest) throw new Error('Corrupt Issue selection snapshot');
    return record.selection;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Real read-only GitHub ingress. Redirects and PR-shaped Issues are refused. */
export function createSelfDeliveryGitHubIssueReader(input: {
  repositoryId: number; token(): Promise<string>; fetch?: typeof fetch;
}): (number: number) => Promise<SelfDeliveryIssue> {
  return async number => {
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Invalid Issue number');
    const transport = input.fetch ?? fetch;
    const headers = { authorization: `Bearer ${await input.token()}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const request = async (path: string) => {
      const response = await transport(`https://api.github.com/repos/zhinjs/zhin${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`GitHub Issue ingress failed (${response.status})`);
      return response.json();
    };
    const repository = await request('') as { id: number };
    if (repository.id !== input.repositoryId) throw new Error('GitHub repository identity changed');
    const issue = await request(`/issues/${number}`) as { id: number; number: number; title: string; body: string | null; updated_at: string; state: 'open' | 'closed'; pull_request?: unknown };
    if (issue.pull_request) throw new Error('Select an Issue, not a pull request');
    return { repositoryId: repository.id, id: issue.id, number: issue.number, title: issue.title,
      body: issue.body ?? '', updatedAt: issue.updated_at, state: issue.state };
  };
}
