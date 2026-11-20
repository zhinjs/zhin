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
import type { CoreReplyStream, ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import type { Segment } from '@zhin.js/im-contract';
import type {
  ActorTurnResult,
  EscalationNotice,
  Harness,
  Mail,
} from '@zhin.js/harness';
import { AsyncResource } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { getLogger } from '@zhin.js/logger';
import { resolveLocale, type Locale } from '@zhin.js/plugin-runtime';
import type { AgentCore } from '../core/agent-core.js';
import type { InteractiveRun } from '../core/interactive-run.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { ImageInspectionBudget } from '../media/local-image-inspection.js';
import type { ContextFile } from '../bootstrap.js';
import type { PluginAILoopHookRegistry } from '../plugin-loop-hooks.js';
import type { AgentCapabilities, ToolCapability } from '../plugin-runtime/capability-ingress.js';
import type { TurnProvenance } from '../security/provenance.js';
import type { ReplyAnswerContext, ReplyPort, TurnIngress } from '../turn/turn-ingress.js';
import { createActorTurnRunner } from './actor-turn.js';
import { createCollaborationDirectory } from './directory.js';
import { currentMailTurn } from './mail-turn-context.js';
import { createCollaborationTools } from './tools.js';
import { createDelegatedReads, takeConsumedResult } from './delegation-waiters.js';
import { renderExternalContent } from '../security/trust-level.js';
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
  /**
   * The root turn's reply reached the human (#1250 delegate-result-double-reply): delegated results that
   * arrive afterwards are a possible supplement to it, never a second answer.
   */
  replied(text: string): void;
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
  /** A failed result the entry model read in a waiting `delegate` and answered from was told (#1250). */
  const noteFailuresRead = (committed: readonly Mail[]): void => {
    const failed = committed.filter((mail) => FAILED_RESULT_STATUSES.has(resultStatus(mail) ?? ''));
    if (failed.length) outcomes.failuresTold(failed);
  };
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
    runTurn: AsyncResource.bind(async (actor: string, delivered: readonly Mail[], signal: AbortSignal) => {
      const entry = actor === entryName;
      // #1250 delegate-result-double-reply: a result the delegating turn already read (a waited `delegate`)
      // and answered from does not wake its actor again — the entry actor or a sub-agent that delegated.
      const batch: Mail[] = [];
      for (const mail of delivered) {
        if (!await takeConsumedResult(harness, mail)) batch.push(mail);
      }
      if (batch.length === 0) {
        logger.debug(`collaboration result already read by the delegating turn: ${describeResults(delivered)}`);
        return Object.freeze({ status: 'completed' as const, content: 'result already read' });
      }
      // Results this actor turn's own waiting `delegate` calls read: consumed only if the turn succeeds.
      const reads = createDelegatedReads(harness);
      let readsDecided = false;
      const commitReads = (): void => {
        readsDecided = true;
        // The actor turn has ended: a read noted later never reached its answer (#1250 第 56 批).
        const committed = reads.commit({ final: true });
        if (entry) noteFailuresRead(committed);
      };
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
      // #1250 delegate-result-double-reply: the human already has this request's answer. The result is a
      // possible supplement: the entry model sees what it said and may decline to say more.
      const earlier = resultsOnly ? outcomes.answered() : undefined;
      if (entry) outcomes.entryStarted();
      const failures = resultsOnly && outcomes.failureOnly(batch);
      let result: ActorTurnOutcome;
      try {
        try {
          result = await runner(actor, batch, signal, {
            delegatedReads: reads,
            ...(earlier ? { preface: supplementPreface(earlier, { failure: failures }) } : {}),
          });
        } finally {
          if (entry && outcomes.entryFinished()) await announceStop();
        }
        if (!entry) outcomes.recordSubTurn(batch, result.status);
        // The entry actor continuing with delegated results speaks to the human directly.
        if (!resultsOnly) {
          if (result.status === 'completed') commitReads();
          return result;
        }
        let toSend = result;
        if (earlier) {
          const plan = planSupplement(result, { failures, locale: turn.input.locale });
          if (plan.kind === 'cancelled') {
            // A stopped supplement told nobody anything: a failure stays untold (its next account may run).
            logger.debug(`collaboration supplement cancelled: ${describeResults(batch)}`);
            return result;
          }
          if (plan.kind === 'nothing') {
            logger.info(`collaboration result kept out of the chat (already answered): ${describeResults(batch)}`);
            // Nothing new to say: the human's answer stands for this request.
            commitReads();
            return result;
          }
          toSend = plan.outcome;
        }
        const delivering = toSend;
        await background.deliverResult(delivering, signal, () => {
          if (failures) outcomes.failuresTold(batch);
          if (delivering.reply) outcomes.replied(delivering.reply);
          if (delivering.status === 'completed' || delivering.status === 'budget_exceeded') commitReads();
        });
        return result;
      } finally {
        if (!readsDecided) reads.revoke();
      }
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
  // #1250: results the root turn's waiting `delegate` calls read count as answered only once its reply
  // reached the human; a failed, timed-out, superseded or stopped root turn lets them wake the entry agent.
  const rootReads = createDelegatedReads(harness);
  const commitRootReads = (final = false): void => { noteFailuresRead(rootReads.commit({ final })); };
  const tools = createCollaborationTools(
    { harness, directory, actor: entryName, mail: root },
    {
      owner: capabilities.owner, onEscalate, onVenueTell, onStopped: () => outcomes.entryInformed(),
      delegatedReads: rootReads,
      ...(mailTurn.deadline !== undefined ? { turnDeadline: mailTurn.deadline } : {}),
    },
  );
  const collaboration: TurnCollaboration = {
    harness,
    directory,
    root,
    tools,
    replied(text: string) {
      outcomes.replied(text);
      if (text.trim()) commitRootReads();
    },
    // The Mailbox settles the turn; delegated work keeps running and reports back on the lane.
    async finish(status) {
      if (status === 'completed') commitRootReads(true);
      else rootReads.revoke();
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
  /** What the human was already told for this request (the root reply and supplements). */
  let answer = '';
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
    /** A reply of this request reached the human. */
    replied(text: string): void {
      const told = text.trim();
      if (told) answer = answer ? `${answer}\n${told}` : told;
    },
    /** What the human was already told for this request; `undefined` before any reply. */
    answered(): string | undefined {
      return answer || undefined;
    },
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

/** Entry output that means "nothing to add" for a result arriving after the request was answered. */
export const NO_REPLY_MARKER = '[[no_reply]]';

/** {@link NO_REPLY_MARKER} as models write it: any case, inner spaces, wrapped in backticks. */
const NO_REPLY_PATTERN = /`*\[\[\s*no_reply\s*\]\]`*/giu;
/** Non-global {@link NO_REPLY_PATTERN}, for `test`. */
const NO_REPLY_FOUND = /\[\[\s*no_reply\s*\]\]/iu;

/**
 * True when `text` declines with {@link NO_REPLY_MARKER}: it is the marker, or starts with it (whitespace,
 * backticks and case ignored). What follows a leading marker is the model explaining itself.
 */
export function isNoReply(text: string): boolean {
  const bare = text.replace(/^[\s`]+|[\s`]+$/gu, '');
  return /^\[\[\s*no_reply\s*\]\]/iu.test(bare);
}

/** `text` without any {@link NO_REPLY_MARKER}: the marker is control output, never shown to the human. */
export function stripNoReplyMarker(text: string): string {
  return text.replace(NO_REPLY_PATTERN, '').trim();
}

/**
 * The root turn's output without {@link NO_REPLY_MARKER} (#1250): the marker only means something to a
 * supplement turn; a root turn that writes it must not show it to the human. Text left empty is dropped.
 */
export function stripNoReplyOutput(output: readonly AgentOutputElement[]): AgentOutputElement[] {
  const kept: AgentOutputElement[] = [];
  for (const element of output) {
    if (element.type === 'text') {
      if (!/no_reply/iu.test(element.content)) { kept.push(element); continue; }
      const content = stripNoReplyMarker(element.content);
      if (content) kept.push({ ...element, content });
      continue;
    }
    if (element.type === 'message') {
      const segments = element.segments.flatMap((segment) => {
        if (segment.type !== 'text' && segment.type !== 'markdown') return [segment];
        const key = segment.type === 'text' ? 'text' : 'content';
        const value = String((segment.data as Record<string, unknown>)[key] ?? '');
        if (!/no_reply/iu.test(value)) return [segment];
        const stripped = stripNoReplyMarker(value);
        return stripped ? [{ ...segment, data: { ...segment.data, [key]: stripped } } as typeof segment] : [];
      });
      if (segments.length) kept.push({ ...element, segments });
      continue;
    }
    kept.push(element);
  }
  return kept;
}

/** A suffix that may still grow into {@link NO_REPLY_MARKER} (`[`, `[[`, `[[ no_`, `[[no_reply]` …). */
const PARTIAL_NO_REPLY = /^\[(?:\[\s*(?:n(?:o(?:_(?:r(?:e(?:p(?:l(?:y\s*\]?)?)?)?)?)?)?)?)?)?$/iu;
/** Longest suffix held back while it can still become a marker (inner whitespace included). */
const MAX_PENDING_MARKER = 64;

/**
 * Start of the suffix of `text` that may still become a marker (`text.length` when none), never before
 * `floor`: what precedes it was already settled when an earlier marker was removed, so it was shown.
 */
function pendingMarkerStart(text: string, floor = 0): number {
  let start = text.length;
  const from = Math.max(floor, text.length - MAX_PENDING_MARKER);
  for (const candidate of [text.lastIndexOf('[['), text.endsWith('[') ? text.length - 1 : -1]) {
    if (candidate >= from && candidate < start && PARTIAL_NO_REPLY.test(text.slice(candidate))) start = candidate;
  }
  // Backticks right before it (or trailing backticks alone) may open a wrapped marker.
  while (start > from && text[start - 1] === '`') start -= 1;
  return start;
}

/**
 * `text` as a root turn's stream may show it (#1250 第 56 批): every {@link NO_REPLY_MARKER} removed and,
 * while the part is still growing, a tail that may become one held back. Only text after the last removed
 * marker is held (`x [` stays shown once `x [[[no_reply]]` completes). Never trimmed, so each result is a
 * prefix of the next one: the core reply stream only accepts content appended to what it published.
 */
export function streamTextWithoutNoReply(text: string, complete: boolean): string {
  let cleaned = '';
  let settled = 0;
  let last = 0;
  for (const match of text.matchAll(NO_REPLY_PATTERN)) {
    cleaned += text.slice(last, match.index);
    last = match.index + match[0].length;
    settled = cleaned.length;
  }
  cleaned += text.slice(last);
  return complete ? cleaned : cleaned.slice(0, pendingMarkerStart(cleaned, settled));
}

function markerText(value: Segment): string | undefined {
  if (value.type !== 'text' && value.type !== 'markdown') return undefined;
  return String((value.data as Record<string, unknown>)[value.type === 'text' ? 'text' : 'content'] ?? '');
}

/**
 * A streamed answer snapshot as a root turn may publish it: text parts through
 * {@link streamTextWithoutNoReply}; a part (then a message) this leaves empty is left out, and so is a
 * part that is still only whitespace while it grows or once a marker was removed from it.
 */
export function stripNoReplySnapshot(snapshot: ReplyStreamSnapshot): ReplyStreamSnapshot {
  let changed = false;
  const messages = snapshot.messages.flatMap((message) => {
    let emptied = false;
    const segments = message.segments.flatMap((part) => {
      const text = markerText(part.value);
      if (text === undefined) return [part];
      let shown = streamTextWithoutNoReply(text, part.complete);
      // Whitespace alone is held while the part grows (it may be all that is left once a marker
      // completes, as in `\n[[no_reply]]`) and dropped when a removed marker leaves nothing else.
      if (!shown.trim() && (!part.complete || shown !== text)) shown = '';
      if (shown === text) return [part];
      changed = true;
      if (!shown) { emptied = true; return []; }
      const key = part.value.type === 'text' ? 'text' : 'content';
      return [{ ...part, value: { ...part.value, data: { ...part.value.data, [key]: shown } } as Segment }];
    });
    return segments.length || !emptied ? [{ ...message, segments }] : [];
  });
  return changed ? { ...snapshot, messages } : snapshot;
}

function confirmedShowsMarker(stream: CoreReplyStream): boolean {
  return stream.confirmed.some(part => part.segments.some(segment => NO_REPLY_FOUND.test(markerText(segment) ?? '')));
}

/**
 * The reply port of a root turn with collaboration (#1250 第 56 批): its streams publish every update and
 * the finish through {@link stripNoReplySnapshot}, so `[[no_reply]]` never reaches the platform, not even
 * in an intermediate update. Should a marker already have been published anyway, the finish is passed on
 * unchanged (rewriting a published prefix would turn the reply into a rejected delivery) and logged.
 */
export function withoutNoReplyStream(port: ReplyPort): ReplyPort {
  if (!port.openStream) return port;
  return Object.freeze({
    send: (output: readonly AgentOutputElement[], context?: ReplyAnswerContext) => context ? port.send(output, context) : port.send(output),
    ...(port.segments ? { segments: port.segments } : {}),
    openStream: (context?: Pick<ReplyAnswerContext, 'phaseId'>) => {
      const stream = context ? port.openStream!(context) : port.openStream!();
      if (!stream) return undefined;
      return Object.freeze({
        get receipt() { return stream.receipt; },
        get confirmed() { return stream.confirmed; },
        get minIntervalMs() { return stream.minIntervalMs; },
        update: (snapshot: ReplyStreamSnapshot) => stream.update(stripNoReplySnapshot(snapshot)),
        finish: (snapshot: ReplyStreamSnapshot) => {
          if (confirmedShowsMarker(stream)) {
            logger.warn('reply stream already published [[no_reply]]; its finish is passed on unchanged');
            return stream.finish(snapshot);
          }
          return stream.finish(stripNoReplySnapshot(snapshot));
        },
        cancel: () => stream.cancel(),
      }) as CoreReplyStream;
    },
  });
}

const SUPPLEMENT_ANSWER_MAX_CHARS = 1_200;

/**
 * Model-facing lines before a delegated result that arrived after the request was answered (#1250
 * delegate-result-double-reply). The earlier reply is shown as data (it may quote anything the human or
 * a tool wrote), never as instructions. A failure batch has no way out: the human hears about it once.
 */
export function supplementPreface(earlier: string, options: Readonly<{ failure?: boolean }> = {}): string {
  const said = earlier.length > SUPPLEMENT_ANSWER_MAX_CHARS ? `${earlier.slice(0, SUPPLEMENT_ANSWER_MAX_CHARS)}…` : earlier;
  return [
    '[Already answered] For this request you already sent the human the reply quoted below.',
    renderExternalContent('earlier_reply', said),
    'The delegated result below arrived after that reply. Do not repeat or restate what you already said.',
    ...(options.failure
      ? ['- The delegated work did not finish. Tell the human so in one short sentence, in the human\'s language; do not retry it yourself.']
      : [
          `- When it adds nothing the human needs (the same answer), reply with exactly ${NO_REPLY_MARKER} and nothing else.`,
          '- Only when it adds something new and important (a correction, or the result your reply promised), reply with just that addition, in the human\'s language. It is sent as a supplement to your earlier reply.',
        ]),
  ].join('\n');
}

const SUPPLEMENT_LEAD = /^\s*(?:补充|更正|update\b|addendum\b|correction\b)/iu;

/**
 * The entry turn's outcome after an answered request, as the supplement the human may see; `undefined`
 * when there is nothing to send (the model declined with {@link NO_REPLY_MARKER}, said nothing, or was
 * stopped). A failed entry turn keeps its outcome: the human hears that the follow-up could not be put
 * together.
 */
export function asSupplement(result: ActorTurnOutcome, locale: Locale | undefined): ActorTurnOutcome | undefined {
  if (result.status === 'cancelled') return undefined;
  if (result.status === 'failed') return result;
  const reply = result.reply ?? '';
  if (!reply.trim() || isNoReply(reply)) return undefined;
  const text = stripNoReplyMarker(reply);
  if (!text) return undefined;
  const lead = resolveLocale(locale) === 'en' ? 'Update: ' : '补充：';
  return Object.freeze({ ...result, reply: SUPPLEMENT_LEAD.test(text) ? text : `${lead}${text}` });
}

/** What a supplement turn (a result after the answer) sends: {@link planSupplement}. */
export type SupplementPlan =
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'nothing' }>
  | Readonly<{ kind: 'send'; outcome: ActorTurnOutcome }>;

/**
 * The supplement turn's outcome for the human (#1250): `cancelled` (stopped: nothing was said, and a failure
 * stays untold), `nothing` (the model declined a result that adds nothing) or the message to `send`. A failure
 * batch is told once even when the model declined or said nothing: a fixed line, never silence.
 */
export function planSupplement(
  result: ActorTurnOutcome,
  input: Readonly<{ failures: boolean; locale: Locale | undefined }>,
): SupplementPlan {
  if (result.status === 'cancelled') return { kind: 'cancelled' };
  const supplement = asSupplement(result, input.locale);
  if (supplement) return { kind: 'send', outcome: supplement };
  if (!input.failures) return { kind: 'nothing' };
  return { kind: 'send', outcome: Object.freeze({ ...result, status: 'completed' as const, reply: supplementFailureLine(input.locale) }) };
}

/** Fixed line when the entry model declined to tell a failure that arrived after the answer. */
export function supplementFailureLine(locale: Locale | undefined): string {
  return resolveLocale(locale) === 'en'
    ? 'Update: the background task did not finish.'
    : '补充：后台任务没有完成。';
}

/** One line for further failures of a request whose first failure was already told. */
function moreFailuresLine(count: number, locale: Locale | undefined): string {
  return resolveLocale(locale) === 'en'
    ? `${count} more background task${count === 1 ? '' : 's'} did not finish.`
    : `另有 ${count} 项后台任务没有完成。`;
}

/** One line closing a request whose background collaboration the guard stopped. */
function collaborationStoppedLine(locale: Locale | undefined): string {
  return resolveLocale(locale) === 'en'
    ? 'The background task stopped: it reached the collaboration limit for this request.'
    : '后台任务已停止：这次请求的协作次数到了上限。';
}

/** Why the human is told a background task did not reach them. */
type BackgroundFailure = 'aggregation_failed' | 'delivery_failed' | 'budget_exhausted' | 'empty_result';

function backgroundFailureNotice(reason: BackgroundFailure, locale: Locale | undefined): string {
  const en = resolveLocale(locale) === 'en';
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
function budgetStoppedLine(locale: Locale | undefined): string {
  return resolveLocale(locale) === 'en'
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
