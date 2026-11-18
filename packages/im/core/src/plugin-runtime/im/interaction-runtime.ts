import { resolveLocale, type RuntimeSnapshot, type Locale } from '@zhin.js/plugin-runtime';
import { interactionMessages as t } from '../../built/interaction-messages.js';
import { projectLocale } from './inbound-spine.js';
import {
  conversationRefKey,
  type ConversationRef,
  type DeliveryReceipt,
  type MessageRef,
  type UserInteraction,
  type UserInteractionRequest,
  type UserInteractionSequence,
  type UserInteractionSequenceResult,
  type UserInteractionStep,
  type UserInteractionValue,
} from '@zhin.js/im-contract';
import {
  assertUserInteractionRequest,
  parseUserInteractionAnswer,
  projectUserInteraction,
  renderUserInteraction,
  type UserInteractionProgress,
  type UserInteractionView,
} from '../../built/user-interaction.js';
import { tagInteractionOwner } from './interaction-end.js';
import { isInteractionCancelFirst, isInteractionCancelReply } from '../../built/interaction-cancel.js';
import { randomUUID } from 'node:crypto';
import {
  RuntimeMessage,
  interactionOperationScope,
  operationEndpoint,
  type CapturedEndpointOperation,
  type InteractionOperationScope,
  type Message,
  type MessageSenderRef,
  type SendContent,
  type SendRequest,
} from './contracts.js';
import {
  actionPayloadFromSegments,
  isJsxButtonPayload,
  isPluginIncarnationAlive,
  JsxButtonRegistry,
  RuntimeInteractiveRouter,
  type JsxButtonBatch,
  type PluginIncarnationRef,
  type RememberFallbackContext,
} from './interactive-router.js';
import type { Segment } from '../../built/segment-contract/types.js';

export { isPluginIncarnationAlive, type PluginIncarnationRef } from './interactive-router.js';

interface InteractionAnswer { readonly value: string; readonly action: boolean; }

/** Prompt data shares one fixed deadline across retries after an invalid answer. */
interface InteractionClaimRequest {
  readonly deadline: number;
  readonly timeoutText: string;
  readonly prompt: UserInteractionView;
  readonly locale: Locale;
  readonly actions?: readonly { readonly value: string }[];
  /** Whether a plain-text answer parses for this request (ADR 0061: answered vs consumed). */
  readonly classify?: (raw: string, action: boolean) => boolean;
  /** Plugin that asked, when known. */
  readonly owner?: string;
}

/** Authority belongs to the participant and captured operation, never to rendered text. */
interface InteractionClaimAuthority {
  readonly conversation: ConversationRef;
  readonly subjectId: string;
  readonly generation?: number;
  readonly signal?: AbortSignal;
  readonly operation?: InteractionOperationScope;
  readonly source?: CapturedEndpointOperation;
}

interface UserInteractionClaim {
  readonly generation?: number;
  readonly incarnation?: PluginIncarnationRef;
  readonly isLiveFor: (generation: number, currentSnapshot?: RuntimeSnapshot) => boolean;
  readonly actions: ReadonlyMap<string, string>;
  readonly classify?: (raw: string, action: boolean) => boolean;
  readonly owner?: string;
  readonly accept: (raw: string, action?: boolean) => boolean;
  /** An answer was accepted and waits for the prompt's delivery; later messages never end the prompt. */
  readonly hasBuffered: () => boolean;
  readonly reject: (error: Error) => void;
  readonly delivered: () => void;
  readonly answer: Promise<InteractionAnswer>;
  readonly check: () => void;
  readonly dispose: () => void;
  readonly project: (generation: number, currentSnapshot?: RuntimeSnapshot) => PendingUserInteraction | undefined;
}

/** A live conversational prompt; its callbacks still require the original subject and generation. */
export interface PendingUserInteraction {
  readonly id: string;
  readonly generation: number;
  readonly conversation: ConversationRef;
  readonly subjectId: string;
  readonly expiresAt: number;
  readonly segments: SendContent;
}

const ASK_ACTION_PREFIX = 'zhin:ask:';
/** Claim subject of a prompt that anyone in the conversation may answer (`answeredBy: 'anyone'`). */
const ANYONE_SUBJECT = '\u0000anyone';

/** ADR 0061 P5 / decision 11: how a claimed message was taken. */
export interface InteractionClaimResolution {
  /** The message parses as an answer to the prompt (otherwise it was consumed). */
  readonly answerLike: boolean;
  readonly owner?: string;
  /**
   * ADR 0061 decision 11 (revised, #1250): the message was not taken. It ended the sender's
   * prompt (a command or media) and goes on through normal inbound processing.
   */
  readonly escaped?: true;
  /** With `escaped`: whether to tell the sender once that the prompt ended (throttled). */
  readonly notify?: boolean;
}

/** Options of {@link RuntimeInteractionCoordinator.resolveClaimDetailed}. */
export interface InteractionClaimOptions {
  /** Whether the message routes to a command (CommandIndex match); such a message ends the prompt. */
  readonly matchesCommand?: () => boolean;
}

/** Segment types that make a message "media" for prompt escape (images, files, voice, video). */
const ESCAPE_MEDIA_SEGMENTS: ReadonlySet<string> = new Set(['image', 'file', 'audio', 'voice', 'record', 'video']);
/** Throttled reminders while a prompt waits after repeated invalid answers (decision 11, revised). */
const REMINDER_LIMIT = 2;
const REMINDER_INTERVAL_MS = 20_000;
/** "Left the previous question" is said at most once per sender and conversation in this window. */
const EXIT_NOTICE_INTERVAL_MS = 60_000;
const EXIT_NOTICE_KEYS = 256;

export interface UserInteractionSource {
  readonly locale?: Locale;
  readonly generation?: number;
  readonly conversation: ConversationRef;
  readonly sender?: MessageSenderRef;
  readonly $reply: (content: SendContent) => Promise<DeliveryReceipt>;
}

class UserInteractionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserInteractionTimeoutError';
  }
}

/**
 * The sender left the prompt: replied a cancel word (`cancelled`) or sent a command, media or a
 * mention meanwhile (`interrupted`). An expected end, never an internal error (ADR 0061
 * `interaction_cancelled`); callers match it by `name`, like the other interaction errors.
 */
class UserInteractionCancelledError extends Error {
  readonly reason: 'cancelled' | 'interrupted';
  constructor(reason: 'cancelled' | 'interrupted') {
    super(reason === 'cancelled' ? 'User interaction cancelled' : 'User interaction interrupted by a new message');
    this.name = 'UserInteractionCancelledError';
    this.reason = reason;
  }
}

class UserInteractionSupersededError extends Error {
  constructor() {
    super('User interaction replaced by a newer prompt in this conversation');
    this.name = 'UserInteractionSupersededError';
  }
}

class UserInteractionDeliveryError extends Error {
  constructor(receipt: DeliveryReceipt) {
    super(`User interaction delivery failed: ${receipt.failure?.code ?? receipt.status}`);
    this.name = 'UserInteractionDeliveryError';
  }
}

/** Owns one ImRuntime's conversational claims, actions, and keyboard fallback state. */
export class RuntimeInteractionCoordinator<Admission = never> {
  readonly #router: RuntimeInteractiveRouter<Admission>;
  readonly #claims = new Map<string, UserInteractionClaim>();
  readonly #buttons = new JsxButtonRegistry();
  readonly #pendingFallbackIncarnations = new Map<string, PluginIncarnationRef>();
  readonly #markPrompt: ((message: MessageRef) => void) | undefined;
  readonly #exitNotices = new Map<string, number>();

  /** `markPrompt` keeps a delivered prompt out of conversation context, like its answer. */
  constructor(
    router = new RuntimeInteractiveRouter<Admission>({ numberingScope: 'conversation' }),
    markPrompt?: (message: MessageRef) => void,
  ) {
    this.#router = router;
    this.#markPrompt = markPrompt;
  }

  register(
    prefix: string,
    handler: (message: Message) => Promise<boolean> | boolean,
    admission?: Admission,
  ): () => void {
    return this.#router.register(prefix, handler, admission);
  }

  rememberFallback(
    conversation: ConversationRef,
    generation: number,
    map: Record<string, string>,
    ttlMsOrContext?: number | RememberFallbackContext | PluginIncarnationRef,
  ): Record<string, string> {
    const pendingKey = `${generation}:${conversationRefKey(conversation)}`;
    const pendingIncarnation = this.#pendingFallbackIncarnations.get(pendingKey);
    if (ttlMsOrContext === undefined && pendingIncarnation) {
      return this.#router.rememberFallback(conversation, generation, map, { incarnation: pendingIncarnation });
    }
    if (typeof ttlMsOrContext === 'number' && pendingIncarnation) {
      return this.#router.rememberFallback(conversation, generation, map, {
        ttlMs: ttlMsOrContext,
        incarnation: pendingIncarnation,
      });
    }
    return this.#router.rememberFallback(conversation, generation, map, ttlMsOrContext);
  }

  async dispatch(message: Message, admission?: Admission, snapshot?: RuntimeSnapshot): Promise<boolean> {
    const effectiveSnapshot = snapshot ?? (message instanceof RuntimeMessage ? message[interactionOperationScope]()?.snapshot : undefined);
    const payload = this.#router.resolvePayload(message, { snapshot: effectiveSnapshot });
    if (payload && effectiveSnapshot && await this.#buttons.dispatch(message, payload, effectiveSnapshot)) return true;
    if (payload?.startsWith(ASK_ACTION_PREFIX)) {
      await message.$reply(t(message.locale, 'expired'));
      return true;
    }
    if (this.#router.isExpiredFallback(message, effectiveSnapshot, { ignoreTtlExpiredBareGroupNumbers: true })) {
      await message.$reply(t(message.locale, 'expired'));
      return true;
    }
    return this.#router.dispatch(message, admission, effectiveSnapshot);
  }

  prepareButtons(request: SendRequest, snapshot: RuntimeSnapshot): JsxButtonBatch {
    const signal = request[operationEndpoint]?.signal;
    const incarnation: PluginIncarnationRef = {
      requester: request.requester,
      snapshot,
      node: snapshot.tree.get(request.requester),
      ...(signal ? { signal } : {}),
    };
    const key = `${snapshot.generation}:${conversationRefKey(request.conversation)}`;
    this.#pendingFallbackIncarnations.set(key, incarnation);
    if (this.#pendingFallbackIncarnations.size > 256) {
      const oldest = this.#pendingFallbackIncarnations.keys().next().value;
      if (oldest !== undefined) this.#pendingFallbackIncarnations.delete(oldest);
    }
    return this.#buttons.prepare(request, snapshot);
  }

  resolveClaim(message: Message, snapshot?: RuntimeSnapshot, options?: InteractionClaimOptions): boolean {
    const resolution = this.resolveClaimDetailed(message, snapshot, options);
    return resolution !== false && resolution.escaped !== true;
  }

  /**
   * {@link resolveClaim} plus whether the text was answer-like (ADR 0061 `interaction_answered` /
   * `interaction_consumed`). A message from the asked sender that carries media, or that is not an
   * answer and routes to a command, ends the prompt instead (`escaped`). A mention of the bot alone
   * never does: on many platforms every reply to the bot carries one.
   */
  resolveClaimDetailed(message: Message, snapshot?: RuntimeSnapshot, options?: InteractionClaimOptions): false | InteractionClaimResolution {
    const effectiveSnapshot = snapshot ?? (message instanceof RuntimeMessage ? message[interactionOperationScope]()?.snapshot : undefined);
    const own = this.#claims.get(this.#conversationKey(message));
    const claim = own?.isLiveFor(message.generation, effectiveSnapshot)
      ? own : this.#claims.get(this.#conversationKey(message, ANYONE_SUBJECT)) ?? own;
    const claimLive = claim?.isLiveFor(message.generation, effectiveSnapshot) === true;
    if (claim && !claimLive && effectiveSnapshot && claim.incarnation && !isPluginIncarnationAlive(claim.incarnation, effectiveSnapshot)) {
      claim.reject(new Error('User interaction operation retired'));
    }
    const effectiveGeneration = claimLive && claim?.generation !== undefined
      ? claim.generation
      : message.generation;
    const payload = this.#router.resolvePayload(message, {
      fallbackGeneration: effectiveGeneration,
      snapshot: effectiveSnapshot,
    });
    // A current question owns ordinary text answers, including numbers that once
    // labelled an expired button. Explicit JSX callbacks still belong to buttons.
    if (isJsxButtonPayload(payload)) return false;
    const explicit = actionPayloadFromSegments(message.segments);
    // Another feature's callback is not a plain-text answer to this question.
    if (explicit && !explicit.startsWith(ASK_ACTION_PREFIX)) return false;
    if (!claim || !claimLive) return false;
    const classify = (raw: string, action: boolean): boolean => {
      try { return claim.classify?.(raw, action) ?? true; } catch { return false; }
    };
    const taken = (raw: string, action: boolean): false | InteractionClaimResolution => {
      const answerLike = classify(raw, action);
      return claim.accept(raw, action) ? Object.freeze({ answerLike, ...(claim.owner ? { owner: claim.owner } : {}) }) : false;
    };
    const askAction = payload?.startsWith(ASK_ACTION_PREFIX) === true && claim.actions.has(payload);
    // "@bot 2" in a group answers the prompt: the mention itself is not part of the answer.
    const plain = payload ?? message.content;
    const text = message.mentioned === true && !classify(plain, false) ? textWithoutMentions(message) ?? plain : plain;
    // An answer already taken (waiting for the prompt's delivery) is never displaced by a later message.
    if (!askAction && !claim.hasBuffered() && this.#escapes(message, text, classify, options)) {
      // An `anyone` prompt is not the sender's own: the message passes through and the prompt stays.
      if (claim !== own) return false;
      claim.reject(new UserInteractionCancelledError('interrupted'));
      return Object.freeze({ answerLike: false, escaped: true, notify: this.#takeExitNotice(this.#conversationKey(message)),
        ...(claim.owner ? { owner: claim.owner } : {}) });
    }
    if (payload?.startsWith(ASK_ACTION_PREFIX)) {
      const answer = claim.actions.get(payload);
      if (answer !== undefined) return taken(answer, true);
      // Native stale callbacks never answer a new question. Plain text remains
      // the current question's input even if an old fallback once used its label.
      return explicit ? false : taken(message.content, false);
    }
    return taken(text, false);
  }

  /**
   * Media always escapes; a command escapes unless the text is a valid answer. A mention of the bot
   * is no exit of its own (ADR 0061 decision 11, revised): platforms that deliver group messages
   * only when the bot is mentioned, or mark a reply to the bot as a mention, put one on every
   * answer, so "@bot 3" to a two-option prompt is an invalid answer and gets the prompt again. The
   * command probe already ignores leading mentions, so "@bot /status" still escapes.
   */
  #escapes(
    message: Message,
    raw: string,
    classify: (raw: string, action: boolean) => boolean,
    options: InteractionClaimOptions | undefined,
  ): boolean {
    if (message.segments?.some(segment => ESCAPE_MEDIA_SEGMENTS.has(segment.type))) return true;
    if (classify(raw, false)) return false;
    if (!options?.matchesCommand) return false;
    try { return options.matchesCommand(); } catch { return false; }
  }

  /** True when the sender was not told "left the previous question" in the last minute. */
  #takeExitNotice(key: string): boolean {
    const now = Date.now();
    const last = this.#exitNotices.get(key);
    if (last !== undefined && now - last < EXIT_NOTICE_INTERVAL_MS) return false;
    if (this.#exitNotices.size >= EXIT_NOTICE_KEYS && last === undefined) {
      for (const [entry, at] of this.#exitNotices) if (now - at >= EXIT_NOTICE_INTERVAL_MS) this.#exitNotices.delete(entry);
      if (this.#exitNotices.size >= EXIT_NOTICE_KEYS) this.#exitNotices.clear();
    }
    this.#exitNotices.set(key, now);
    return true;
  }

  /**
   * Probe used by Room routing: is this message the answer to something pending on this exact
   * (Endpoint-scoped) conversation? True when the sender has a pending conversational claim, or
   * when the message itself resolves to a button of a live keyboard fallback. A live keyboard
   * alone does not count. Changes no state.
   */
  hasPendingAnswer(
    conversation: ConversationRef,
    senderId: string,
    generation: number,
    input?: { readonly content: string; readonly segments?: readonly Segment[] },
    snapshot?: RuntimeSnapshot,
  ): boolean {
    const own = this.#claims.get(`${conversationRefKey(conversation)}:${senderId}`);
    const claim = own?.isLiveFor(generation, snapshot) ? own
      : this.#claims.get(`${conversationRefKey(conversation)}:${ANYONE_SUBJECT}`) ?? own;
    const explicit = actionPayloadFromSegments(input?.segments);
    if (explicit?.startsWith(ASK_ACTION_PREFIX)
      && (!claim?.isLiveFor(generation, snapshot) || !claim.actions.has(explicit))) return false;
    if (claim?.isLiveFor(generation, snapshot)
      && (!explicit || claim.actions.has(explicit))) return true;
    return input !== undefined && this.#router.resolvesLiveFallback(conversation, generation, input, snapshot);
  }

  /** Read-only current prompt; never re-delivers, renews its deadline or accepts an answer. */
  readPendingInteraction(
    conversation: ConversationRef,
    subjectId: string,
    generation: number,
    snapshot?: RuntimeSnapshot,
  ): PendingUserInteraction | undefined {
    return this.#claims.get(`${conversationRefKey(conversation)}:${subjectId}`)?.project(generation, snapshot);
  }

  createForMessage(
    message: Message,
    bind?: { readonly subjectId: string },
  ): UserInteraction | undefined {
    const subjectId = bind?.subjectId?.trim();
    if (bind && !subjectId) return undefined;
    if (typeof message.$reply !== 'function' || !message.conversation) return undefined;
    return this.create(message, subjectId, message instanceof RuntimeMessage ? message[interactionOperationScope]() : undefined);
  }

  createFromUnknown(source: unknown): UserInteraction | undefined {
    if (!source || typeof source !== 'object') return undefined;
    const message = source as Message;
    if (typeof message.$reply !== 'function' || !message.conversation) return undefined;
    return this.createForMessage(message);
  }

  create(source: UserInteractionSource, subjectId?: string, operation?: InteractionOperationScope): UserInteraction {
    const defaultTimeout = 3 * 60 * 1000;
    const locale = resolveLocale(source.locale ?? (operation ? projectLocale(operation.snapshot) : undefined));
    const defaultTimeoutText = t(locale, 'timeout');
    const withSource = async <T>(execute: (source?: CapturedEndpointOperation) => Promise<T>): Promise<T> => {
      const retained = operation?.retain?.();
      try { return await execute(retained); }
      finally { retained?.release(); }
    };
    const askWithin = async <Request extends UserInteractionRequest>(
      request: Request,
      progress: UserInteractionProgress | undefined,
      retained?: CapturedEndpointOperation,
    ): Promise<UserInteractionValue<Request>> => {
      assertUserInteractionRequest(request);
      const assertLifetime = () => {
        for (const lifetime of [request.signal, retained?.signal ?? operation?.signal]) lifetime?.throwIfAborted();
      };
      const reply = retained ? (content: SendContent) => retained.send(content, { locale }) : source.$reply;
      assertLifetime();
      const timeout = request.timeout ?? defaultTimeout;
      const timeoutText = request.timeoutText ?? defaultTimeoutText;
      const deadline = Date.now() + timeout;
      const view = projectUserInteraction(request, progress, locale);
      let prompt = view;
      // ADR 0061 decision 11 (revised, #1250): after an invalid answer the prompt is sent again
      // once; later invalid answers get a short reminder, at most REMINDER_LIMIT times and
      // REMINDER_INTERVAL_MS apart, instead of waiting silently until the deadline.
      let invalidAnswers = 0;
      let reminders = 0;
      let lastReminderAt = Number.NEGATIVE_INFINITY;
      const reminderText = t(locale, request.type === 'select' || request.type === 'multiselect' ? 'waitingSelect'
        : request.type === 'text' ? 'waitingText' : request.type === 'confirm' ? 'confirmation' : 'waitingAnswer');
      // A cancel word is an answer too: it ends the prompt (`interaction_answered`, not consumed).
      const classify = (raw: string, action: boolean) => parseUserInteractionAnswer(request, raw, locale, action).ok
        || isInteractionCancelReply(request, raw, action);
      const answeredBy = request.answeredBy === 'anyone' ? ANYONE_SUBJECT : undefined;
      while (true) {
        const claim = this.#reserveClaim({ deadline, timeoutText, prompt, locale, actions: view.actions, classify,
          ...(operation?.owner ? { owner: String(operation.owner) } : {}) }, {
          conversation: source.conversation, subjectId: answeredBy ?? subjectId ?? source.sender?.id ?? '',
          generation: source.generation, signal: request.signal, operation, source: retained,
        });
        try {
          claim.check();
          if (invalidAnswers <= 1) {
            const actions = [...claim.actions.keys()];
            const receipt = await reply(renderUserInteraction(prompt, (_value, index) => actions[index]!, locale));
            assertLifetime();
            if (receipt.status !== 'sent') throw new UserInteractionDeliveryError(receipt);
            if (receipt.message) this.#markPrompt?.(receipt.message);
          } else if (reminders < REMINDER_LIMIT && Date.now() - lastReminderAt >= REMINDER_INTERVAL_MS) {
            reminders += 1;
            lastReminderAt = Date.now();
            // A lost reminder is not a failed prompt: the question itself was delivered already.
            const receipt = await reply(reminderText);
            assertLifetime();
            if (receipt.status === 'sent' && receipt.message) this.#markPrompt?.(receipt.message);
          }
          claim.delivered();
          const raw = await claim.answer;
          claim.check();
          // A list would read a lone `取消` as the item `['取消']`: the prompt said it cancels (#1250).
          if (isInteractionCancelFirst(request, raw.value, raw.action)) throw new UserInteractionCancelledError('cancelled');
          const result = parseUserInteractionAnswer(request, raw.value, locale, raw.action);
          if (result.ok) return result.value as UserInteractionValue<Request>;
          if (isInteractionCancelReply(request, raw.value, raw.action)) throw new UserInteractionCancelledError('cancelled');
          invalidAnswers += 1;
          prompt = {
            ...view,
            tip: [request.invalidText ?? result.message, view.tip].filter(Boolean).join('\n'),
          };
        } catch (error) {
          claim.reject(error instanceof Error ? error : new Error('User interaction failed'));
          // The timeout may have fired while outbound I/O was still pending.
          // A subsequently retired operation must never apply its default.
          assertLifetime();
          if (error instanceof UserInteractionTimeoutError
            && 'default' in request
            && request.default !== undefined) {
            return request.default as UserInteractionValue<Request>;
          }
          if (error instanceof UserInteractionTimeoutError) {
            await reply(renderUserInteraction({ title: t(locale, 'ended'), description: error.message }, undefined, locale));
          }
          // An interrupted prompt is announced by the inbound runtime before the new message runs.
          if (error instanceof UserInteractionCancelledError && error.reason === 'cancelled') await reply(t(locale, 'cancelled'));
          // Timeout and cancellation are expected ends: the inbound runtime records them as
          // `interaction_timeout` / `interaction_cancelled`, never as `internal_error` (#1250),
          // naming the plugin that asked.
          tagInteractionOwner(error, operation?.owner !== undefined ? String(operation.owner) : undefined);
          throw error;
        } finally {
          claim.dispose();
        }
      }
    };

    const ask = <Request extends UserInteractionRequest>(request: Request,
      progress?: UserInteractionProgress): Promise<UserInteractionValue<Request>> =>
      withSource(retained => askWithin(request, progress, retained));

    const sequence = async <Steps extends readonly UserInteractionStep[]>(
      definition: UserInteractionSequence<Steps>,
    ): Promise<UserInteractionSequenceResult<Steps>> => withSource(async retained => {
      if (!definition.title.trim()) {
        throw new TypeError('User interaction sequence title must not be empty');
      }
      const ids = new Set<string>();
      for (const step of definition.steps) {
        if (!step.id.trim()) {
          throw new TypeError('User interaction sequence step id must not be empty');
        }
        if (ids.has(step.id)) {
          throw new TypeError(`Duplicate user interaction sequence step id: ${step.id}`);
        }
        ids.add(step.id);
      }
      const result: Record<string, unknown> = {};
      for (let index = 0; index < definition.steps.length; index += 1) {
        const step = definition.steps[index]!;
        const request = {
          ...step,
          timeout: step.timeout ?? definition.timeout,
          timeoutText: step.timeoutText ?? definition.timeoutText,
          invalidText: step.invalidText ?? definition.invalidText,
          signal: step.signal ?? definition.signal,
        } as UserInteractionRequest;
        result[step.id] = await askWithin(request, {
          title: definition.title,
          description: definition.description,
          tip: definition.tip,
          index: index + 1,
          total: definition.steps.length,
        }, retained);
      }
      return Object.freeze(result) as UserInteractionSequenceResult<Steps>;
    });

    return Object.freeze({ ask, sequence });
  }

  #reserveClaim(request: InteractionClaimRequest, authority: InteractionClaimAuthority): UserInteractionClaim {
    const { deadline, timeoutText, prompt, locale, actions } = request;
    const { conversation, subjectId, generation: sourceGeneration, signal, operation, source } = authority;
    const key = `${conversationRefKey(conversation)}:${subjectId}`;
    this.#claims.get(key)?.reject(new UserInteractionSupersededError());
    const id = randomUUID();
    const generation = operation?.snapshot.generation ?? sourceGeneration;
    const incarnation: PluginIncarnationRef | undefined = operation
      ? {
          requester: operation.owner,
          snapshot: operation.snapshot,
          node: operation.snapshot.tree.get(operation.owner),
          ...(source?.signal ?? operation.signal ? { signal: source?.signal ?? operation.signal } : {}),
        }
      : undefined;
    const answers = new Map(actions?.map((action, index) => [`${ASK_ACTION_PREFIX}${id}:${index}`, action.value]));
    let resolve!: (value: InteractionAnswer) => void;
    let reject!: (error: Error) => void;
    const answer = new Promise<InteractionAnswer>((yes, no) => { resolve = yes; reject = no; });
    // Prompt delivery may still be pending when cancellation rejects the claim.
    // Observe that rejection immediately without detaching the actual outbound I/O.
    void answer.catch(() => undefined);
    let failure: Error | undefined;
    let delivered = false;
    let buffered: InteractionAnswer | undefined;
    const unsubscribers: (() => void)[] = [];
    const dispose = () => {
      if (this.#claims.get(key) === claim) this.#claims.delete(key);
      clearTimeout(timer);
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    };
    const fail = (error: Error) => {
      if (failure) return;
      failure = error;
      dispose();
      reject(error);
    };
    const timer = setTimeout(() => fail(new UserInteractionTimeoutError(timeoutText)), Math.max(1, deadline - Date.now()));
    const isLiveFor = (candidate: number, currentSnapshot?: RuntimeSnapshot) => {
      if (failure || Date.now() >= deadline) return false;
      if (incarnation?.signal?.aborted || source?.signal.aborted) return false;
      if (currentSnapshot && incarnation) {
        if (source) {
          return !incarnation.node || currentSnapshot.tree.get(incarnation.requester) === incarnation.node;
        }
        return isPluginIncarnationAlive(incarnation, currentSnapshot);
      }
      return source ? !source.signal.aborted : generation === candidate;
    };
    const claim: UserInteractionClaim = {
      generation,
      ...(incarnation ? { incarnation } : {}),
      isLiveFor,
      actions: answers,
      ...(request.classify ? { classify: request.classify } : {}),
      ...(request.owner ? { owner: request.owner } : {}),
      answer,
      accept: (raw, action = false) => {
        if (failure || buffered !== undefined) return false;
        if (Date.now() >= deadline) { fail(new UserInteractionTimeoutError(timeoutText)); return false; }
        buffered = { value: raw, action };
        if (delivered) resolve(buffered);
        return true;
      },
      hasBuffered: () => buffered !== undefined,
      delivered: () => { if (!failure) { delivered = true; if (buffered !== undefined) resolve(buffered); } },
      reject: fail,
      check: () => {
        if (!failure && Date.now() >= deadline) fail(new UserInteractionTimeoutError(timeoutText));
        if (failure) throw failure;
      },
      dispose,
      project: (currentGeneration, currentSnapshot) => {
        if (generation === undefined || !isLiveFor(currentGeneration, currentSnapshot) || !delivered || failure
          || buffered !== undefined || Date.now() >= deadline) return undefined;
        return {
          id, generation, subjectId, expiresAt: deadline,
          conversation: { ...conversation, endpoint: { ...conversation.endpoint },
            ...(conversation.parent ? { parent: { ...conversation.parent } } : {}) },
          segments: renderUserInteraction(prompt, (_value, index) => [...answers.keys()][index]!, locale),
        };
      },
    };
    this.#claims.set(key, claim);
    if (deadline <= Date.now()) fail(new UserInteractionTimeoutError(timeoutText));
    for (const lifetime of [signal, source?.signal ?? operation?.signal]) {
      if (!lifetime) continue;
      const abort = () => fail(abortError(lifetime, 'User interaction operation retired'));
      if (lifetime.aborted) { abort(); break; }
      lifetime.addEventListener('abort', abort, { once: true });
      unsubscribers.push(() => lifetime.removeEventListener('abort', abort));
    }
    return claim;
  }

  #conversationKey(source: UserInteractionSource, subjectId = source.sender?.id ?? ''): string {
    return `${conversationRefKey(source.conversation)}:${subjectId}`;
  }
}

/** The text segments of a message without its mentions and quotes, when it has segments. */
function textWithoutMentions(message: Message): string | undefined {
  const segments = message.segments;
  if (!segments?.length) return undefined;
  const text = segments
    .filter(segment => segment.type === 'text' && typeof (segment.data as { text?: unknown } | undefined)?.text === 'string')
    .map(segment => (segment.data as { text: string }).text)
    .join('')
    .trim();
  return text || undefined;
}

function abortError(signal: AbortSignal | undefined, fallback: string): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new Error(fallback);
}
