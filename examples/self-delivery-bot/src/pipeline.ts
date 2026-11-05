import { existsSync } from 'node:fs';
import { createToken } from 'zhin.js';
import {
  ALL,
  DEFAULT_GUARD_LIMITS,
  InMemoryBudgetLedger,
  InMemoryEngagementJournal,
  attenuate,
  createGuardKernel,
  createHarness,
  createMailbox,
  isAttenuationOf,
  only,
  rootAuthority,
  type AgentCeiling,
  type BoardEntry,
  type BudgetAmounts,
  type EngagementSummary,
  type Principal,
} from '@zhin.js/harness';

export interface SelfDeliveryIssueInput {
  readonly identity: string;
  readonly issueNumber: number;
  readonly acceptanceCriteria: readonly string[];
}

export interface SelfDeliveryPipelineResult {
  readonly engagementId: string;
  readonly issueNumber: number;
  readonly status: 'approved' | 'rejected';
  readonly reply: string;
  readonly board: readonly BoardEntry[];
  readonly summary: EngagementSummary;
}

const DEFAULT_BUDGET: BudgetAmounts = {
  modelCalls: 16,
  tokens: 64_000,
  wallMs: 60_000,
  sideEffects: 8,
};

const PIPELINE_CEILINGS: readonly AgentCeiling[] = [
  {
    agent: 'planner',
    tools: ALL,
    contacts: ALL,
    maxTrust: 'master',
    egress: { network: false, hosts: ALL },
    acceptsFrom: ALL,
  },
  {
    agent: 'builder',
    tools: only(['board_read', 'board_write', 'tell']),
    contacts: only(['planner', 'reviewer']),
    maxTrust: 'master',
    egress: { network: false, hosts: ALL },
    acceptsFrom: only(['planner', 'reviewer']),
  },
  {
    agent: 'reviewer',
    tools: only(['board_read', 'board_write']),
    contacts: only(['planner', 'builder']),
    maxTrust: 'master',
    egress: { network: false, hosts: ALL },
    acceptsFrom: only(['planner', 'builder']),
  },
];

/**
 * Runs a self-delivery issue pipeline (`planner` -> `builder` -> `reviewer`)
 * on `@zhin.js/harness` using `createHarness`, `InMemoryEngagementJournal`,
 * `writeBoard` / `readBoard`, and `ask` / `delegate`.
 */
export async function runSelfDeliveryPipeline(
  input: SelfDeliveryIssueInput,
): Promise<SelfDeliveryPipelineResult> {
  if (!Number.isSafeInteger(input.issueNumber) || input.issueNumber <= 0) {
    throw new TypeError('issueNumber must be a positive integer');
  }
  const criteria = input.acceptanceCriteria.map((item) => item.trim()).filter(Boolean);
  if (criteria.length === 0) {
    throw new TypeError('acceptanceCriteria must contain at least one criterion');
  }

  const journal = new InMemoryEngagementJournal();
  const ceilings = new Map(PIPELINE_CEILINGS.map((c) => [c.agent, c]));
  let finalReply = '';
  let approved = false;

  const harness = createHarness({
    guard: createGuardKernel({ isAttenuationOf }),
    ledger: new InMemoryBudgetLedger(),
    journal,
    createMailbox: (options) => createMailbox(options),
    ceilingOf: (agent) => ceilings.get(agent),
    rootAuthority,
    attenuate,
    limits: DEFAULT_GUARD_LIMITS,
    runTurn: async (actor, batch) => {
      const mail = batch[0]!;
      if (actor === 'planner') {
        if (mail.body.kind === 'result') {
          return { status: 'completed', content: mail.body.content };
        }
        const planText = [
          `Issue #${input.issueNumber}`,
          ...criteria.map((c, idx) => `${idx + 1}. ${c}`),
        ].join('\n');
        await harness.writeBoard(mail.engagementId, {
          author: 'planner',
          key: 'plan',
          kind: 'artifact',
          content: planText,
        });
        await harness.writeBoard(mail.engagementId, {
          author: 'planner',
          key: 'todo:implement',
          kind: 'todo',
          status: 'in_progress',
          content: `Implement Issue #${input.issueNumber}`,
        });

        const buildOutcome = await harness.send('planner', mail, {
          kind: 'ask',
          to: 'builder',
          text: `Implement Issue #${input.issueNumber} according to board key "plan".`,
        });
        if (!buildOutcome.ok) {
          return { status: 'failed', content: buildOutcome.reason };
        }

        const reviewOutcome = await harness.send('planner', mail, {
          kind: 'ask',
          to: 'reviewer',
          text: `Verify board key "draft" against board key "plan" for Issue #${input.issueNumber}.`,
        });
        if (!reviewOutcome.ok) {
          return { status: 'failed', content: reviewOutcome.reason };
        }

        const reviewText = reviewOutcome.reply?.content ?? '';
        approved = reviewText.startsWith('APPROVED:');
        await harness.writeBoard(mail.engagementId, {
          author: 'planner',
          key: 'todo:implement',
          kind: 'todo',
          status: approved ? 'done' : 'pending',
          content: `Implement Issue #${input.issueNumber}`,
        });
        finalReply = `Issue #${input.issueNumber} (${approved ? 'approved' : 'rejected'}): ${reviewText}`;
        return { status: 'completed', content: finalReply };
      }

      if (actor === 'builder') {
        const plans = await harness.readBoard(mail.engagementId, { key: 'plan' });
        const planContent = plans[0]?.content ?? '';
        const draftContent = `Patch for Issue #${input.issueNumber}\nVerified criteria:\n${planContent}`;
        await harness.writeBoard(mail.engagementId, {
          author: 'builder',
          key: 'draft',
          kind: 'artifact',
          content: draftContent,
        });
        return { status: 'completed', content: `draft written for #${input.issueNumber}` };
      }

      if (actor === 'reviewer') {
        const entries = await harness.readBoard(mail.engagementId);
        const planEntry = entries.find((e) => e.key === 'plan');
        const draftEntry = entries.find((e) => e.key === 'draft');
        const allCovered = Boolean(
          planEntry
          && draftEntry
          && criteria.every((criterion) => draftEntry.content.includes(criterion)),
        );
        const verdict = allCovered
          ? `APPROVED: Issue #${input.issueNumber} satisfies ${criteria.length} acceptance criteria`
          : `REJECTED: missing acceptance criteria on board`;
        await harness.writeBoard(mail.engagementId, {
          author: 'reviewer',
          key: 'review',
          kind: 'note',
          content: verdict,
        });
        return { status: 'completed', content: verdict };
      }

      return { status: 'completed', content: `${actor} done` };
    },
  });

  const principal: Principal = {
    kind: 'human',
    id: input.identity,
    trust: 'master',
    venue: { kind: 'private', id: input.identity },
  };

  const opened = await harness.open({
    principal,
    entry: 'planner',
    body: {
      kind: 'human',
      text: `Deliver issue #${input.issueNumber}: ${criteria.join('; ')}`,
      venue: { kind: 'private', id: input.identity },
    },
    budget: DEFAULT_BUDGET,
  });

  if (!opened.ok) {
    await harness.close();
    throw new Error(`Failed to open self-delivery engagement: ${opened.reason}`);
  }

  await harness.idle();
  const board = await harness.readBoard(opened.engagement.id);
  const summary = await journal.summarize(opened.engagement.id);
  await harness.close();

  if (!summary) {
    throw new Error(`Missing engagement summary for ${opened.engagement.id}`);
  }

  return {
    engagementId: opened.engagement.id,
    issueNumber: input.issueNumber,
    status: approved ? 'approved' : 'rejected',
    reply: finalReply,
    board,
    summary,
  };
}

export class SelfDeliveryProject {
  readonly stateDirectory: string;
  readonly configured: boolean;

  constructor(stateDirectory: string, options: { configured?: boolean } = {}) {
    this.stateDirectory = stateDirectory;
    this.configured = options.configured ?? existsSync(stateDirectory);
  }

  async doctor(): Promise<{ configured: boolean; ready: boolean; stateDirectory: string }> {
    return {
      configured: this.configured,
      ready: this.configured,
      stateDirectory: this.stateDirectory,
    };
  }

  async select(input: SelfDeliveryIssueInput): Promise<SelfDeliveryPipelineResult> {
    if (!this.configured) {
      throw new Error(`Self-delivery project is not configured at ${this.stateDirectory}`);
    }
    return runSelfDeliveryPipeline(input);
  }
}

export const selfDeliveryProjectToken = createToken<SelfDeliveryProject>(
  'self-delivery.project',
  'Harness-backed self-delivery pipeline service',
);
