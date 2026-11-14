/**
 * ADR 0048 H2/H3 — collaboration for one IM / interactive turn.
 *
 * The turn runs inside the host's long-lived harness Mailbox (H3): its Mail
 * comes from {@link currentMailTurn}. When the turn has peer agents, its
 * collaboration directory and actor runner are bound to the Mail's
 * engagement and the turn gets the collaboration tools bound to that Mail.
 * Other agents run as actor turns of the same harness. Delegated work may
 * outlive the turn; its results come back as turns of the entry actor on the
 * session lane, whose replies are delivered to the human as proactive messages
 * to the original conversation through the Runtime outbound port (the turn's
 * `delivery` port): the message's reply scope closes with the root turn.
 * Guard escalations are told to the human the same way. Actor turns run on
 * their own model operations (a delegation the host bounds), never on the root
 * turn's, which closes when the root turn ends (#1250). Without peers (or
 * outside a Mail turn) nothing is added (D3).
 */
import type { VenueProjector } from '@zhin.js/core';
import type {
  ActorTurnResult,
  EscalationNotice,
  Harness,
  Mail,
} from '@zhin.js/harness';
import { AsyncResource } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { getLogger } from '@zhin.js/logger';
import type { AgentCore } from '../core/agent-core.js';
import type { InteractiveRun } from '../core/interactive-run.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { ImageInspectionBudget } from '../media/local-image-inspection.js';
import type { ContextFile } from '../bootstrap.js';
import type { PluginAILoopHookRegistry } from '../plugin-loop-hooks.js';
import type { AgentCapabilities, ToolCapability } from '../plugin-runtime/capability-ingress.js';
import type { TurnProvenance } from '../security/provenance.js';
import type { TurnIngress } from '../turn/turn-ingress.js';
import { createActorTurnRunner } from './actor-turn.js';
import { createCollaborationDirectory } from './directory.js';
import { currentMailTurn } from './mail-turn-context.js';
import { createCollaborationTools } from './tools.js';
import type { ActorModelSelection, ActorModelSource, ActorTurnOutcome, CollaborationDirectory } from './contracts.js';
import { getAgentTurnConfiguration } from '../turn/agent-turn-context.js';
import type { AgentOutputElement } from '../outbound/agent-output.js';
import type { ModelDelegationAuthority } from '../model-runtime/types.js';

export { DEFAULT_ENGAGEMENT_BUDGET } from './host-mailbox.js';

const logger = getLogger('ai.collaboration');

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
  readonly provenance?: TurnProvenance;
  readonly venueProjector?: VenueProjector;
}

export type StartTurnCollaborationInput = TurnCollaborationInput;

export interface TurnCollaboration {
  readonly harness: Harness;
  readonly directory: CollaborationDirectory;
  readonly root: Mail;
  /** Collaboration tools for the live root turn. */
  readonly tools: readonly ToolCapability[];
  /** Ends the root turn; delegated work keeps running and reports back later. */
  finish(status: ActorTurnResult['status']): Promise<void>;
}

export type TurnCollaborationSession = TurnCollaboration;

/**
 * Starts collaboration for `input.turn`. Returns `undefined` when the turn has
 * no other agent to collaborate with (or does not run inside a Mail turn), so
 * ordinary turns pay nothing.
 */
export async function startTurnCollaboration(input: TurnCollaborationInput): Promise<TurnCollaboration | undefined> {
  const { turn, capabilities } = input;
  const hasPeersOrSelf = capabilities.agents.some(
    (agent) =>
      agent.name !== input.entry
      || agent.collaboration?.contacts?.includes('self')
      || agent.collaboration?.contacts?.includes(input.entry),
  );
  if (!hasPeersOrSelf) return undefined;
  const mailTurn = currentMailTurn();
  if (!mailTurn) {
    logger.debug('collaboration skipped: the turn does not run inside the host mailbox');
    return undefined;
  }
  const root = mailTurn.mail;
  if (root.to !== input.entry) {
    logger.debug(`collaboration skipped: mail is for ${root.to}, the turn runs ${input.entry}`);
    return undefined;
  }
  const harness = mailTurn.mailbox.harness;
  const catalogTools = capabilities.tools.map((tool) => tool.name);
  const directory = createCollaborationDirectory({
    entry: { name: input.entry, toolNames: catalogTools, allowSelfDelegation: true },
    agents: capabilities.agents,
    catalogTools,
  });
  const reply = turn.ports.reply;
  const background = createBackgroundTeller(turn);
  // Tools of actor turns can escalate after the root turn ended: its reply scope
  // is closed then, so the notice goes out as a proactive message instead.
  const tell = async (text: string): Promise<void> => {
    if (turn.policy.unattended) return;
    if (reply) {
      try {
        await reply.send([{ type: 'text', content: text }]);
        return;
      } catch (error) {
        logger.debug(`collaboration reply unavailable, delivering proactively: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await background.tell(text, AbortSignal.timeout(BACKGROUND_DELIVERY_TIMEOUT_MS));
  };
  const onEscalate = async (reason: string): Promise<string> => {
    await tell(`需要你来决定：${reason}`);
    return 'The human has been asked to decide; stop this line of work and wait for their answer in a later message.';
  };
  const onVenueTell = async (venueId: string, content: string): Promise<void> => {
    await mailTurn.mailbox.projectVenueTell(root.engagementId, directory.entry.name, root.id, venueId, content);
  };
  const onToolCalled = async (info: {
    readonly engagementId: string;
    readonly actor: string;
    readonly mailId: string;
    readonly tool: string;
    readonly ok: boolean;
  }): Promise<void> => {
    await mailTurn.mailbox.recordToolCalled(info);
  };

  const delegation = retainModelDelegation();
  const models: ActorModelSource | undefined = delegation ? Object.freeze({
    acquire: (request: Parameters<ActorModelSource['acquire']>[0]) => delegation.acquire({
      operationId: request.operationId,
      sessionKey: request.sessionKey,
      ...(request.agent ? { agent: request.agent } : {}),
      signal: request.signal,
    }),
  }) : undefined;
  const runner = createActorTurnRunner({
    host: input.host,
    core: input.core,
    rootTurn: turn,
    capabilities,
    directory,
    harness: () => harness,
    createTools: createCollaborationTools,
    resolveModel: input.resolveModel,
    ...(models ? { models } : {}),
    loopHooks: input.loopHooks,
    bootstrapContext: input.bootstrapContext,
    contextFiles: input.contextFiles,
    interactiveRun: input.interactiveRun,
    imageInspectionBudget: input.imageInspectionBudget,
    provenance: input.provenance,
    onEscalate,
    onVenueTell,
    onToolCalled,
  });
  // Actor turns of this engagement run from the Mailbox pump, possibly after
  // the root turn ended; bind them to the root turn's async context (turn
  // configuration, models, mail turn) as the per-turn harness of H2 did.
  mailTurn.mailbox.bindCollaboration(root.engagementId, {
    directory,
    ...(input.venueProjector ? { venueProjector: input.venueProjector } : {}),
    runTurn: AsyncResource.bind(async (actor: string, batch: readonly Mail[], signal: AbortSignal) => {
      const result = await runner(actor, batch, signal);
      // The entry actor continuing with delegated results speaks to the human directly.
      if (actor === directory.entry.name && batch.every((mail) => mail.body.kind === 'result')) {
        await background.deliverResult(result, signal);
      }
      return result;
    }),
    onEscalate: AsyncResource.bind(async (notice: EscalationNotice) => {
      await background.tell(`协作已暂停，需要你来决定：${notice.reason}`, AbortSignal.timeout(BACKGROUND_DELIVERY_TIMEOUT_MS));
    }),
    // The delegation reservation lives as long as the engagement (the host bounds both).
    ...(delegation ? { onClosed: () => { void delegation.release().catch(() => undefined); } } : {}),
  });
  const tools = createCollaborationTools(
    { harness, directory, actor: directory.entry.name, mail: root },
    { owner: capabilities.owner, onEscalate, onVenueTell },
  );
  const collaboration: TurnCollaboration = {
    harness,
    directory,
    root,
    tools,
    // The Mailbox settles the turn; delegated work keeps running and reports back on the lane.
    async finish() {},
  };
  return Object.freeze(collaboration);
}

const BACKGROUND_DELIVERY_TIMEOUT_MS = 30_000;

/** Retains the root turn's model operation for actor turns that outlive it; absent outside a model turn. */
function retainModelDelegation(): ModelDelegationAuthority | undefined {
  const models = getAgentTurnConfiguration()?.models;
  if (!models) return undefined;
  try {
    return models.retainDelegation();
  } catch (error) {
    logger.warn(`collaboration model delegation unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/** Why the human is told a background task did not reach them. */
type BackgroundFailure = 'aggregation_failed' | 'delivery_failed' | 'budget_exhausted' | 'empty_result';

function backgroundFailureNotice(reason: BackgroundFailure, locale: string | undefined): string {
  const en = locale?.toLowerCase().startsWith('en');
  switch (reason) {
    case 'aggregation_failed':
      return en
        ? 'A background task failed while putting its result together. Please try again.'
        : '后台任务失败：汇总结果时出错了，请稍后再试。';
    case 'budget_exhausted':
      return en
        ? 'A background task ran out of its budget before it produced a result. Please try again.'
        : '后台任务的预算用完了，没能得出结果，请稍后再试。';
    case 'empty_result':
      return en
        ? 'A background task finished without a result.'
        : '后台任务结束了，但没有得出结果。';
    case 'delivery_failed':
      return en
        ? 'A background task finished, but its result could not be delivered. Please try again.'
        : '后台任务完成了，但结果没能发出来，请稍后再试。';
  }
}

/** Short line after a partial answer whose turn ran out of budget. */
function budgetStoppedLine(locale: string | undefined): string {
  return locale?.toLowerCase().startsWith('en')
    ? '(The task ran out of its budget; this is as far as it got.)'
    : '（后台任务的预算用完了，以上是目前得到的结果。）';
}

/**
 * What became of one background message: `sent`; `suppressed` (outbound
 * control withheld it, or nothing was left to send: deliberate, not a
 * failure); `partial` (some of it may have reached the human: a notice would
 * contradict what they saw); `failed`.
 */
type BackgroundSend = 'sent' | 'suppressed' | 'partial' | 'failed';

/**
 * Speaks to the human after the root turn ended: a proactive message to the
 * original conversation through the turn's `delivery` port (Runtime outbound
 * port, unified send chain). Falls back to the reply port for hosts without a
 * delivery port. Never throws.
 */
export function createBackgroundTeller(turn: TurnIngress) {
  const send = async (text: string, signal: AbortSignal): Promise<BackgroundSend> => {
    const output: AgentOutputElement[] = [{ type: 'text', content: text }];
    try {
      const delivery = turn.ports.delivery;
      if (delivery) {
        const outcome = await delivery.deliver({
          intentId: randomUUID(),
          parentTurnId: turn.identity.turnId,
          target: Object.freeze({ conversation: 'origin' }),
          output,
        }, signal);
        if (outcome.status === 'sent') return 'sent';
        if (outcome.status === 'suppressed') {
          logger.debug('collaboration delivery suppressed by outbound control');
          return 'suppressed';
        }
        logger.warn(`collaboration delivery not sent: ${outcome.status} (${outcome.code})`);
        if (outcome.status === 'failed' && (outcome.deliveryPartial || outcome.deliveryUnknown || outcome.messages?.some(Boolean))) {
          return 'partial';
        }
        return 'failed';
      }
      if (!turn.ports.reply) {
        logger.warn('collaboration delivery failed: the turn has no delivery port');
        return 'failed';
      }
      await turn.ports.reply.send(output);
      return 'sent';
    } catch (error) {
      logger.warn(`collaboration delivery failed: ${error instanceof Error ? error.message : String(error)}`);
      return 'failed';
    }
  };
  return Object.freeze({
    async tell(text: string, signal: AbortSignal): Promise<void> {
      if (turn.policy.unattended) return;
      await send(text, signal);
    },
    /**
     * Result of the entry actor continuing with delegated results. Only the
     * actor's own reply ({@link ActorTurnOutcome.reply}) reaches the human,
     * never the model-facing notes in `content` (budget stop, empty reply). A
     * budget-stopped partial reply goes out with a short localized line; a
     * failure, or no reply at all, tells the human why — unless the actor was
     * stopped (user stop, hot reload): then nothing more is said.
     */
    async deliverResult(result: ActorTurnOutcome, actorSignal: AbortSignal): Promise<void> {
      if (turn.policy.unattended) return;
      // Delivery outlives a cancelled actor turn only briefly; the host bounds it.
      const signal = AbortSignal.any([AbortSignal.timeout(BACKGROUND_DELIVERY_TIMEOUT_MS), ...(actorSignal.aborted ? [] : [actorSignal])]);
      const reply = result.reply?.trim();
      const notify = async (reason: BackgroundFailure): Promise<void> => {
        if (actorSignal.aborted) {
          logger.debug(`background collaboration stopped; not notifying (${reason})`);
          return;
        }
        await send(backgroundFailureNotice(reason, turn.input.locale), AbortSignal.timeout(BACKGROUND_DELIVERY_TIMEOUT_MS));
      };
      if (result.status === 'cancelled') {
        logger.debug(`background collaboration result cancelled: ${result.content ?? ''}`);
        return;
      }
      if (result.status === 'failed') {
        logger.warn(`background collaboration result failed${result.content ? `: ${result.content.slice(0, 200)}` : ''}`);
        await notify('aggregation_failed');
        return;
      }
      if (!reply) {
        if (result.status === 'budget_exceeded') {
          logger.warn('background collaboration ran out of budget without a result');
          await notify('budget_exhausted');
        } else {
          logger.warn('background collaboration completed without a reply');
          await notify('empty_result');
        }
        return;
      }
      let text = reply;
      if (result.status === 'budget_exceeded') {
        logger.warn('background collaboration ran out of budget; delivering its partial result');
        text = `${reply}\n\n${budgetStoppedLine(turn.input.locale)}`;
      }
      const sent = await send(text, signal);
      if (sent === 'failed') {
        await notify('delivery_failed');
      } else if (sent === 'partial') {
        logger.warn('background collaboration result was only partly delivered; not adding a failure notice');
      }
    },
  });
}
