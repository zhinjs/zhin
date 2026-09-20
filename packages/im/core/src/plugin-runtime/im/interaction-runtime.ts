import { conversationRefKey, type ConversationRef, type DeliveryReceipt } from '@zhin.js/im-contract';
import type {
  UserInteraction,
  UserInteractionRequest,
  UserInteractionSequence,
  UserInteractionSequenceResult,
  UserInteractionStep,
  UserInteractionValue,
} from '@zhin.js/interaction';
import {
  assertUserInteractionRequest,
  parseUserInteractionAnswer,
  projectUserInteraction,
  renderUserInteraction,
  type UserInteractionProgress,
  type UserInteractionView,
} from '../../built/user-interaction.js';
import type { Message, MessageSenderRef, SendContent } from './contracts.js';
import { RuntimeInteractiveRouter } from './interactive-router.js';

interface UserInteractionClaim {
  readonly resolve: (raw: string) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface UserInteractionSource {
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

  constructor(router = new RuntimeInteractiveRouter<Admission>()) {
    this.#router = router;
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
  ): void {
    this.#router.rememberFallback(conversation, generation, map);
  }

  dispatch(message: Message, admission?: Admission): Promise<boolean> {
    return this.#router.dispatch(message, admission);
  }

  resolveClaim(message: Message): boolean {
    const claim = this.#claims.get(this.#conversationKey(message));
    if (!claim) return false;
    claim.resolve(this.#router.resolvePayload(message) ?? message.content);
    return true;
  }

  createForMessage(
    message: Message,
    bind?: { readonly subjectId: string },
  ): UserInteraction | undefined {
    const subjectId = bind?.subjectId?.trim();
    if (bind && !subjectId) return undefined;
    if (typeof message.$reply !== 'function' || !message.conversation) return undefined;
    return this.create(message, subjectId);
  }

  createFromUnknown(source: unknown): UserInteraction | undefined {
    if (!source || typeof source !== 'object') return undefined;
    const message = source as Message;
    if (typeof message.$reply !== 'function' || !message.conversation) return undefined;
    return this.create(message);
  }

  create(source: UserInteractionSource, subjectId?: string): UserInteraction {
    const defaultTimeout = 3 * 60 * 1000;
    const defaultTimeoutText = '输入超时';
    const claim = (timeout: number, timeoutText: string, signal?: AbortSignal) =>
      this.#claimNextMessage(source, timeout, timeoutText, signal, subjectId);
    const reply = async (view: UserInteractionView): Promise<void> => {
      const receipt = await source.$reply(renderUserInteraction(view));
      if (receipt.status !== 'sent') throw new UserInteractionDeliveryError(receipt);
    };
    const ask = async <Request extends UserInteractionRequest>(
      request: Request,
      progress?: UserInteractionProgress,
    ): Promise<UserInteractionValue<Request>> => {
      assertUserInteractionRequest(request);
      const timeout = request.timeout ?? defaultTimeout;
      const timeoutText = request.timeoutText ?? defaultTimeoutText;
      const deadline = Date.now() + timeout;
      const view = projectUserInteraction(request, progress);
      await reply(view);
      while (true) {
        try {
          const raw = await claim(Math.max(1, deadline - Date.now()), timeoutText, request.signal);
          const result = parseUserInteractionAnswer(request, raw);
          if (result.ok) return result.value as UserInteractionValue<Request>;
          await reply({
            ...view,
            tip: [request.invalidText ?? result.message, view.tip].filter(Boolean).join('\n'),
          });
        } catch (error) {
          if (error instanceof UserInteractionTimeoutError
            && 'default' in request
            && request.default !== undefined) {
            return request.default as UserInteractionValue<Request>;
          }
          if (error instanceof UserInteractionTimeoutError) {
            await reply({ title: '交互已结束', description: error.message });
          }
          throw error;
        }
      }
    };

    const sequence = async <Steps extends readonly UserInteractionStep[]>(
      definition: UserInteractionSequence<Steps>,
    ): Promise<UserInteractionSequenceResult<Steps>> => {
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
        result[step.id] = await ask(request, {
          title: definition.title,
          description: definition.description,
          tip: definition.tip,
          index: index + 1,
          total: definition.steps.length,
        });
      }
      return Object.freeze(result) as UserInteractionSequenceResult<Steps>;
    };

    return Object.freeze({ ask, sequence });
  }

  #claimNextMessage(
    source: UserInteractionSource,
    timeout: number,
    timeoutText: string,
    signal?: AbortSignal,
    subjectId?: string,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal, timeoutText));
        return;
      }
      const key = this.#conversationKey(source, subjectId);
      const existing = this.#claims.get(key);
      if (existing) {
        clearTimeout(existing.timer);
        existing.reject(new UserInteractionSupersededError());
      }
      const timer = setTimeout(() => {
        settle(undefined, new UserInteractionTimeoutError(timeoutText));
      }, timeout);
      const onAbort = () => settle(undefined, abortError(signal, timeoutText));
      signal?.addEventListener('abort', onAbort, { once: true });
      const settle = (value?: string, error?: Error) => {
        if (this.#claims.get(key) !== claim) return;
        this.#claims.delete(key);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (value !== undefined) resolve(value);
        else reject(error ?? new UserInteractionTimeoutError(timeoutText));
      };
      const claim: UserInteractionClaim = {
        resolve: (raw) => settle(raw),
        reject: (error) => settle(undefined, error),
        timer,
      };
      this.#claims.set(key, claim);
    });
  }

  #conversationKey(source: UserInteractionSource, subjectId = source.sender?.id ?? ''): string {
    return `${conversationRefKey(source.conversation)}:${subjectId}`;
  }
}

function abortError(signal: AbortSignal | undefined, fallback: string): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new Error(fallback);
}
