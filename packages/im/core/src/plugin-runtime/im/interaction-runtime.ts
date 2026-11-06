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
  readonly accept: (raw: string, action?: boolean) => boolean;
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

class UserInteractionSupersededError extends Error {
  constructor() {
    super('User interaction superseded');
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

  resolveClaim(message: Message, snapshot?: RuntimeSnapshot): boolean {
    const effectiveSnapshot = snapshot ?? (message instanceof RuntimeMessage ? message[interactionOperationScope]()?.snapshot : undefined);
    const claim = this.#claims.get(this.#conversationKey(message));
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
    if (payload?.startsWith(ASK_ACTION_PREFIX)) {
      const answer = claim.actions.get(payload);
      if (answer !== undefined) return claim.accept(answer, true);
      // Native stale callbacks never answer a new question. Plain text remains
      // the current question's input even if an old fallback once used its label.
      return explicit ? false : claim.accept(message.content);
    }
    return claim.accept(payload ?? message.content);
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
    const claim = this.#claims.get(`${conversationRefKey(conversation)}:${senderId}`);
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
      while (true) {
        const claim = this.#reserveClaim({ deadline, timeoutText, prompt, locale, actions: view.actions }, {
          conversation: source.conversation, subjectId: subjectId ?? source.sender?.id ?? '',
          generation: source.generation, signal: request.signal, operation, source: retained,
        });
        try {
          claim.check();
          const actions = [...claim.actions.keys()];
          const receipt = await reply(renderUserInteraction(prompt, (_value, index) => actions[index]!, locale));
          assertLifetime();
          if (receipt.status !== 'sent') throw new UserInteractionDeliveryError(receipt);
          claim.delivered();
          if (receipt.message) this.#markPrompt?.(receipt.message);
          const raw = await claim.answer;
          claim.check();
          const result = parseUserInteractionAnswer(request, raw.value, locale, raw.action);
          if (result.ok) return result.value as UserInteractionValue<Request>;
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
      answer,
      accept: (raw, action = false) => {
        if (failure || buffered !== undefined) return false;
        if (Date.now() >= deadline) { fail(new UserInteractionTimeoutError(timeoutText)); return false; }
        buffered = { value: raw, action };
        if (delivered) resolve(buffered);
        return true;
      },
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

function abortError(signal: AbortSignal | undefined, fallback: string): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new Error(fallback);
}
