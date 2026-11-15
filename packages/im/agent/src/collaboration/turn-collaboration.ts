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
  /** The conversation session the root turn runs in (what the next turn's prompt is built from). */
  readonly sessionId?: string;
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
  // The model chose to ask the human (the `escalate` tool): its reason is its own words, and the
  // way to decide is to answer in the chat.
  const onEscalate = async (reason: string): Promise<string> => {
    await tell(`需要你来决定：${reason}\n（直接回复这条消息告诉我你的决定即可。）`);
    // The answer arrives as the next message of this session: its turn must see what was asked.
    try {
      input.host.toldLedger?.record(input.sessionId ?? turn.session.key, `已请用户决定：${reason}`, 'progress', turn.identity.turnId);
    } catch (error) {
      logger.debug(`escalation not recorded in the told ledger: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  // The root turn is the engagement's first entry turn; it is running now.
  const outcomes = createEngagementOutcomes();
  outcomes.entryStarted();
  let rootFinished = false;
  const announceStop = async (): Promise<void> => {
    outcomes.stopAnnounced();
    await background.tell(collaborationStoppedLine(turn.input.locale), AbortSignal.timeout(BACKGROUND_DELIVERY_TIMEOUT_MS));
  };
  const entryName = directory.entry.name;
  const runner = createActorTurnRunner({
    host: input.host,
    core: input.core,
    rootTurn: turn,
    capabilities,
    directory,
    harness: () => harness,
    // The entry actor's own refusals tell its model that collaboration stopped.
    createTools: (binding, options) => createCollaborationTools(
      binding,
      binding.actor === entryName ? { ...options, onStopped: () => outcomes.entryInformed() } : options,
    ),
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
      const entry = actor === entryName;
      const resultsOnly = entry && batch.length > 0 && batch.every((mail) => mail.body.kind === 'result');
      if (resultsOnly) {
        const plan = outcomes.plan(batch);
        if (plan.kind !== 'run') {
          // #1250: an internal outcome (budget stop, failure, cancellation) the human must not hear
          // separately; it stays in the engagement journal and the sub-turn's trace.
          logger.info(`collaboration result withheld (${plan.reason}): ${describeResults(batch)}`);
          if (plan.kind === 'line') {
            await background.tell(moreFailuresLine(plan.count, turn.input.locale), AbortSignal.timeout(BACKGROUND_DELIVERY_TIMEOUT_MS));
          }
          return Object.freeze({ status: 'completed' as const, content: `result withheld: ${plan.reason}` });
        }
      }
      if (entry) outcomes.entryStarted();
      let result: ActorTurnOutcome;
      try {
        result = await runner(actor, batch, signal);
      } finally {
        if (entry && outcomes.entryFinished()) await announceStop();
      }
      if (!entry) outcomes.recordSubTurn(batch, result.status);
      // The entry actor continuing with delegated results speaks to the human directly.
      if (resultsOnly) {
        const failures = outcomes.failureOnly(batch);
        await background.deliverResult(result, signal, () => {
          if (failures) outcomes.failuresTold(batch);
        });
      }
      return result;
    }),
    onEscalate: AsyncResource.bind(async (notice: EscalationNotice) => {
      // #1250: the guard's reason is developer text (`Actors … above the limit of 3`): it goes to the
      // log and the engagement journal, never to the chat. No one can resume a frozen engagement, so the
      // human is not asked to decide. An entry model that met the stop (its refusal says so) tells the
      // human in its reply; otherwise one short localized line closes the request, now or when the
      // running entry turn ends.
      logger.warn(`collaboration stopped by the guard (${notice.code}): ${notice.reason}`);
      if (outcomes.stopped()) await announceStop();
    }),
    // The delegation reservation lives as long as the engagement (the host bounds both).
    ...(delegation ? { onClosed: () => { void delegation.release().catch(() => undefined); } } : {}),
  });
  const tools = createCollaborationTools(
    { harness, directory, actor: entryName, mail: root },
    { owner: capabilities.owner, onEscalate, onVenueTell, onStopped: () => outcomes.entryInformed() },
  );
  const collaboration: TurnCollaboration = {
    harness,
    directory,
    root,
    tools,
    // The Mailbox settles the turn; delegated work keeps running and reports back on the lane.
    async finish() {
      if (rootFinished) return;
      rootFinished = true;
      if (outcomes.entryFinished()) await announceStop();
    },
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

/** Result statuses that are an internal outcome of a sub-turn, not an answer. */
const FAILED_RESULT_STATUSES: ReadonlySet<string> = new Set(['failed', 'cancelled', 'budget_exceeded', 'denied']);

function resultStatus(mail: Mail): string | undefined {
  return mail.body.kind === 'result' ? mail.body.status : undefined;
}

function describeResults(batch: readonly Mail[]): string {
  return batch.map((mail) => `${mail.from.kind === 'actor' ? mail.from.actor : mail.from.kind} ${resultStatus(mail) ?? mail.kind}`).join(', ');
}

/** Why a batch of delegated results is not shown to the human as a woken entry turn. */
export type WithheldReason = 'superseded' | 'collaboration_stopped' | 'another_failure';

/** What to do with a batch of delegated results for the entry actor. */
export type ResultBatchPlan =
  | Readonly<{ kind: 'run' }>
  | Readonly<{ kind: 'withhold'; reason: 'superseded' | 'collaboration_stopped' }>
  | Readonly<{ kind: 'line'; reason: 'another_failure'; count: number }>;

/**
 * One user request (engagement) gets one conclusion (#1250 `delegate-failure-message-flood`,
 * `delegate-late-failure-message-contradicts`). A batch of results that are all internal outcomes
 * (failed, budget stop, cancelled, denied) is planned per failed delegation:
 *
 * - superseded: a `follow_up` on that same delegation (the harness sends it with
 *   `causationId` = the delegation's mail id) completed, so its work reached the entry actor; the
 *   failure is stale. A later, separate ask / delegate to the same agent supersedes nothing.
 * - already told: the human already heard about that delegation's failure.
 *
 * When every result is one of those, the batch stays in the trace (`superseded`). Otherwise, when
 * the guard stopped the request's collaboration, the batch stays in the trace too
 * (`collaboration_stopped`: the stop itself is told once, by the entry model or one line). When
 * the human was already told about another failure of this request, the entry model is not woken
 * again: one deterministic line counts the remaining failures (`another_failure`). Only the first
 * failure account of a request wakes the entry model. Batches with any completed result always run.
 *
 * A failure counts as told only once the entry turn's message was actually delivered.
 */
export function createEngagementOutcomes() {
  /** Ask / delegate mails that ran as sub-turns: sender, target, causation. */
  const requests = new Map<string, Readonly<{ from: string; to: string; causationId: string | undefined }>>();
  /** The request `id` follows up on, when it is a follow-up (same sender, same target). */
  const followedUp = (id: string): string | undefined => {
    const request = requests.get(id);
    const original = request?.causationId ? requests.get(request.causationId) : undefined;
    return request && original && original.from === request.from && original.to === request.to
      ? request.causationId
      : undefined;
  };
  /** Delegations a completed follow-up superseded (the whole follow-up chain). */
  const superseded = new Set<string>();
  /** Delegations whose failure the human was told about. */
  const told = new Set<string>();
  let anyFailureTold = false;
  let entryTurns = 0;
  let frozen = false;
  let informed = false;
  let stopTold = false;
  const failureOnly = (batch: readonly Mail[]): boolean =>
    batch.length > 0 && batch.every((mail) => FAILED_RESULT_STATUSES.has(resultStatus(mail) ?? ''));
  const delegationOf = (mail: Mail): string | undefined => (mail.body.kind === 'result' ? mail.body.inReplyTo : undefined);
  const stopPending = (): boolean => frozen && !informed && !stopTold && entryTurns === 0;
  return Object.freeze({
    failureOnly,
    plan(batch: readonly Mail[]): ResultBatchPlan {
      if (!failureOnly(batch)) return { kind: 'run' };
      const open = batch.filter((mail) => {
        const id = delegationOf(mail);
        return id === undefined || (!superseded.has(id) && !told.has(id));
      });
      if (open.length === 0) return { kind: 'withhold', reason: 'superseded' };
      if (frozen) return { kind: 'withhold', reason: 'collaboration_stopped' };
      if (anyFailureTold) {
        for (const mail of open) {
          const id = delegationOf(mail);
          if (id) told.add(id);
        }
        return { kind: 'line', reason: 'another_failure', count: open.length };
      }
      return { kind: 'run' };
    },
    /**
     * A sub-turn finished. A completed follow-up supersedes the delegation it follows up on. A follow-up
     * is an ask whose `causationId` names an ask / delegate the same sender sent to the same agent; an
     * ordinary ask's `causationId` is the mail its sender was processing, which never matches that.
     */
    recordSubTurn(batch: readonly Mail[], status: string): void {
      for (const mail of batch) {
        if (mail.kind !== 'ask' && mail.kind !== 'delegate') continue;
        const from = mail.from.kind === 'actor' ? mail.from.actor : undefined;
        if (from) requests.set(mail.id, { from, to: mail.to, causationId: mail.causationId });
        if (status !== 'completed' || mail.kind !== 'ask' || !from) continue;
        // Walk the follow-up chain back to the delegation (a follow-up may follow up on a follow-up).
        const seen = new Set<string>();
        for (let id = followedUp(mail.id); id && !seen.has(id); id = followedUp(id)) {
          seen.add(id);
          superseded.add(id);
        }
      }
    },
    /** The human was told about the failures of `batch` (the entry turn's message was delivered). */
    failuresTold(batch: readonly Mail[]): void {
      anyFailureTold = true;
      for (const mail of batch) {
        const id = delegationOf(mail);
        if (id) told.add(id);
      }
    },
    entryStarted(): void {
      entryTurns += 1;
    },
    /** An entry turn ended; true when the stop must now be told with one line. */
    entryFinished(): boolean {
      entryTurns = Math.max(0, entryTurns - 1);
      return stopPending();
    },
    /** The entry actor's model met a stop refusal; it tells the human itself. */
    entryInformed(): void {
      informed = true;
    },
    /** The guard stopped the engagement; true when the stop must be told now (no entry turn runs). */
    stopped(): boolean {
      frozen = true;
      return stopPending();
    },
    stopAnnounced(): void {
      stopTold = true;
      anyFailureTold = true;
    },
  });
}

/** One line for further failures of a request whose first failure was already told. */
function moreFailuresLine(count: number, locale: string | undefined): string {
  return locale?.toLowerCase().startsWith('en')
    ? `${count} more background task${count === 1 ? '' : 's'} did not finish.`
    : `另有 ${count} 项后台任务没有完成。`;
}

/** One line closing a request whose background collaboration the guard stopped. */
function collaborationStoppedLine(locale: string | undefined): string {
  return locale?.toLowerCase().startsWith('en')
    ? 'The background task stopped: it reached the collaboration limit for this request.'
    : '后台任务已停止：这次请求的协作次数到了上限。';
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
    async deliverResult(result: ActorTurnOutcome, actorSignal: AbortSignal, onTold?: () => void): Promise<void> {
      if (turn.policy.unattended) return;
      /** Sends, and reports when something actually reached the human. */
      const deliver = async (text: string, deliverSignal: AbortSignal): Promise<BackgroundSend> => {
        const sent = await send(text, deliverSignal);
        if (sent === 'sent' || sent === 'partial') onTold?.();
        return sent;
      };
      // Delivery outlives a cancelled actor turn only briefly; the host bounds it.
      const signal = AbortSignal.any([AbortSignal.timeout(BACKGROUND_DELIVERY_TIMEOUT_MS), ...(actorSignal.aborted ? [] : [actorSignal])]);
      const reply = result.reply?.trim();
      const notify = async (reason: BackgroundFailure): Promise<void> => {
        if (actorSignal.aborted) {
          logger.debug(`background collaboration stopped; not notifying (${reason})`);
          return;
        }
        await deliver(backgroundFailureNotice(reason, turn.input.locale), AbortSignal.timeout(BACKGROUND_DELIVERY_TIMEOUT_MS));
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
      const sent = await deliver(text, signal);
      if (sent === 'failed') {
        await notify('delivery_failed');
      } else if (sent === 'partial') {
        logger.warn('background collaboration result was only partly delivered; not adding a failure notice');
      }
    },
  });
}
