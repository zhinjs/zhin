/**
 * ADR 0048 H2 — collaboration for one live IM / interactive turn.
 *
 * The live turn is the engagement's root actor: it is `attach`ed to a fresh
 * harness and receives the collaboration tools bound to the root mail. Other
 * agents run as actor turns (child turns of the root turn). Delegated work may
 * outlive the root turn; its results come back as turns of the entry actor,
 * whose replies are delivered to the human through the root turn's reply port.
 * Guard escalations are told to the human the same way.
 */
import {
  DEFAULT_GUARD_LIMITS,
  InMemoryBudgetLedger,
  InMemoryEngagementJournal,
  attenuate,
  createGuardKernel,
  createHarness,
  createMailbox,
  isAttenuationOf,
  rootAuthority,
  type ActorTurnResult,
  type BudgetAmounts,
  type Harness,
  type Mail,
  type Principal,
  type TrustLevel as HarnessTrust,
  type VenueRef,
} from '@zhin.js/harness';
import { getLogger } from '@zhin.js/logger';
import type { AgentCore } from '../core/agent-core.js';
import type { InteractiveRun } from '../core/interactive-run.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { ImageInspectionBudget } from '../media/local-image-inspection.js';
import type { ContextFile } from '../bootstrap.js';
import type { PluginAILoopHookRegistry } from '../plugin-loop-hooks.js';
import type { AgentCapabilities, ToolCapability } from '../plugin-runtime/capability-ingress.js';
import { resolveTurnTrustLevel, type InitiatorTrustLevel } from '../security/trust-level.js';
import type { TurnIngress } from '../turn/turn-ingress.js';
import { createActorTurnRunner } from './actor-turn.js';
import { createCollaborationDirectory } from './directory.js';
import { registerCollaboration } from './registry.js';
import { createCollaborationTools } from './tools.js';
import type { ActorModelSelection, CollaborationDirectory } from './contracts.js';

const logger = getLogger('ai.collaboration');

/** Default budget for one engagement; delegations are carved out of it (invariant 2). */
export const DEFAULT_ENGAGEMENT_BUDGET: BudgetAmounts = Object.freeze({
  modelCalls: 60,
  tokens: 400_000,
  wallMs: 10 * 60 * 1000,
  sideEffects: 30,
});

export interface TurnCollaborationInput {
  readonly host: ZhinAgentPrivate;
  readonly core: AgentCore;
  readonly turn: TurnIngress;
  /** The root turn's projected, already-authorized capabilities. */
  readonly capabilities: AgentCapabilities;
  /** Agent name of the root actor (the turn's binding). */
  readonly entry: string;
  readonly resolveModel: () => ActorModelSelection | undefined;
  readonly loopHooks?: PluginAILoopHookRegistry;
  readonly bootstrapContext?: string;
  readonly contextFiles?: readonly ContextFile[];
  readonly interactiveRun?: InteractiveRun;
  readonly imageInspectionBudget?: ImageInspectionBudget;
  readonly budget?: BudgetAmounts;
}

export interface TurnCollaboration {
  readonly harness: Harness;
  readonly directory: CollaborationDirectory;
  readonly root: Mail;
  /** Collaboration tools for the live root turn. */
  readonly tools: readonly ToolCapability[];
  /** Ends the root turn; delegated work keeps running and reports back later. */
  finish(status: ActorTurnResult['status']): Promise<void>;
}

export function harnessTrust(level: InitiatorTrustLevel): HarnessTrust {
  switch (level) {
    case 'owner': return 'master';
    case 'trusted_member': return 'trusted';
    default: return 'group_member';
  }
}

function venueOf(turn: TurnIngress): VenueRef | undefined {
  return turn.origin.kind === 'im'
    ? { kind: `${turn.origin.platform}:${turn.origin.scope}`, id: turn.origin.sceneId }
    : undefined;
}

/**
 * Starts collaboration for `input.turn`. Returns `undefined` when the turn has
 * no other agent to collaborate with, so ordinary turns pay nothing.
 */
export async function startTurnCollaboration(input: TurnCollaborationInput): Promise<TurnCollaboration | undefined> {
  const { turn, capabilities } = input;
  if (capabilities.agents.every((agent) => agent.name === input.entry)) return undefined;
  const catalogTools = capabilities.tools.map((tool) => tool.name);
  const directory = createCollaborationDirectory({
    entry: { name: input.entry, toolNames: catalogTools },
    agents: capabilities.agents,
    catalogTools,
  });
  const venue = venueOf(turn);
  const principal: Principal = Object.freeze({
    kind: 'human',
    id: turn.principal.subjectId,
    trust: harnessTrust(resolveTurnTrustLevel(turn)),
    ...(venue ? { venue } : {}),
  });
  const reply = turn.ports.reply;
  const tell = async (text: string): Promise<void> => {
    if (!reply || turn.policy.unattended) return;
    try {
      await reply.send([{ type: 'text', content: text }]);
    } catch (error) {
      logger.warn(`collaboration reply failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const onEscalate = async (reason: string): Promise<string> => {
    await tell(`需要你来决定：${reason}`);
    return 'The human has been asked to decide; stop this line of work and wait for their answer in a later message.';
  };

  const ref: { harness?: Harness } = {};
  const runner = createActorTurnRunner({
    host: input.host,
    core: input.core,
    rootTurn: turn,
    capabilities,
    directory,
    harness: () => {
      if (!ref.harness) throw new Error('collaboration harness is not ready');
      return ref.harness;
    },
    createTools: createCollaborationTools,
    resolveModel: input.resolveModel,
    loopHooks: input.loopHooks,
    bootstrapContext: input.bootstrapContext,
    contextFiles: input.contextFiles,
    interactiveRun: input.interactiveRun,
    imageInspectionBudget: input.imageInspectionBudget,
    onEscalate,
  });
  const harness = createHarness({
    guard: createGuardKernel({ isAttenuationOf }),
    ledger: new InMemoryBudgetLedger(),
    journal: new InMemoryEngagementJournal(),
    createMailbox: (options) => createMailbox(options, { onError: (error) => logger.warn(`collaboration mailbox: ${String(error)}`) }),
    ceilingOf: (agent) => (agent === directory.entry.name ? directory.entry : directory.get(agent))?.ceiling,
    rootAuthority,
    attenuate,
    limits: DEFAULT_GUARD_LIMITS,
    runTurn: async (actor, batch, signal) => {
      const result = await runner(actor, batch, signal);
      // The entry actor continuing with delegated results speaks to the human directly.
      if (actor === directory.entry.name && batch.every((mail) => mail.body.kind === 'result') && result.content?.trim()) {
        await tell(result.content.trim());
      }
      return result;
    },
    onEscalate: async (notice) => {
      await tell(`协作已暂停，需要你来决定：${notice.reason}`);
    },
    onError: (error) => logger.warn(`collaboration harness: ${error instanceof Error ? error.message : String(error)}`),
  });

  ref.harness = harness;
  const attached = await harness.attach({
    principal,
    entry: directory.entry.name,
    body: { kind: 'human', text: turn.input.text, venue: venue ?? { kind: 'turn', id: turn.session.key }, ...(turn.origin.kind === 'im' && turn.origin.messageId ? { messageId: turn.origin.messageId } : {}) },
    budget: input.budget ?? DEFAULT_ENGAGEMENT_BUDGET,
  });
  if (!attached.ok) {
    logger.warn(`collaboration not started: ${attached.code} ${attached.reason}`);
    return undefined;
  }
  const release = registerCollaboration(harness);
  const owned = harness;
  const tools = createCollaborationTools(
    { harness: owned, directory, actor: directory.entry.name, mail: attached.root },
    { owner: capabilities.owner, onEscalate },
  );
  let finished = false;
  const collaboration: TurnCollaboration = {
    harness: owned,
    directory,
    root: attached.root,
    tools,
    async finish(status) {
      if (finished) return;
      finished = true;
      await attached.detach({ status });
      void owned.idle()
        .then(() => owned.close('engagement settled'))
        .catch((error) => logger.warn(`collaboration close failed: ${String(error)}`))
        .finally(release);
    },
  };
  return Object.freeze(collaboration);
}
