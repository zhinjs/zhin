import type {
  ToolQuestionAnswer,
  ToolQuestionRequest,
} from '@zhin.js/tool';

export interface InteractionAddress {
  readonly sessionKey: string;
  readonly subjectId: string;
}

export interface InteractionReply extends InteractionAddress {
  readonly text: string;
  /** Delivery authority bound to the message currently being consumed. */
  readonly deliver?: InteractionDelivery;
}

export type InteractionDelivery = (text: string) => void | Promise<void>;

interface PendingQuestion {
  readonly address: InteractionAddress;
  readonly request: ToolQuestionRequest;
  readonly resolve: (answer: ToolQuestionAnswer) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly onAbort: () => void;
}

/** Root-owned authority for one pending question per canonical session. */
export class InteractionRouter {
  readonly #pending = new Map<string, PendingQuestion>();
  #closed = false;

  async ask(
    address: InteractionAddress,
    request: ToolQuestionRequest,
    deliver: InteractionDelivery,
  ): Promise<ToolQuestionAnswer> {
    this.#assertAddress(address);
    if (this.#closed) throw new Error('InteractionRouter is closed');
    if (request.signal.aborted) throw request.signal.reason;
    if (this.#pending.has(address.sessionKey)) {
      throw new Error(`A question is already pending for session ${address.sessionKey}`);
    }
    validateRequest(request);

    return new Promise<ToolQuestionAnswer>((resolve, reject) => {
      const timeoutMs = boundedTimeout(request.timeoutMs);
      const onAbort = () => this.#settle(address.sessionKey, undefined, request.signal.reason);
      const timer = setTimeout(() => {
        const fallback = defaultAnswer(request);
        if (fallback) this.#settle(address.sessionKey, fallback);
        else this.#settle(address.sessionKey, undefined, new Error('Question timed out'));
      }, timeoutMs);
      const pending: PendingQuestion = {
        address: Object.freeze({ ...address }),
        request,
        resolve,
        reject,
        timer,
        onAbort,
      };
      this.#pending.set(address.sessionKey, pending);
      request.signal.addEventListener('abort', onAbort, { once: true });
      void Promise.resolve(deliver(formatQuestion(request))).catch((error) => {
        this.#settle(address.sessionKey, undefined, error);
      });
    });
  }

  async consume(reply: InteractionReply): Promise<boolean> {
    const pending = this.#pending.get(reply.sessionKey);
    if (!pending || pending.address.subjectId !== reply.subjectId) return false;
    const answer = parseAnswer(pending.request, reply.text);
    if (!answer) {
      const deliver = reply.deliver;
      if (!deliver) {
        const error = new Error('Invalid interaction reply requires current delivery authority');
        this.#settle(reply.sessionKey, undefined, error);
        throw error;
      }
      try {
        await deliver(validationMessage(pending.request));
      } catch (error) {
        this.#settle(reply.sessionKey, undefined, error);
        throw error;
      }
      return true;
    }
    this.#settle(reply.sessionKey, answer);
    return true;
  }

  close(reason: unknown = new Error('InteractionRouter closed')): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const sessionKey of [...this.#pending.keys()]) this.#settle(sessionKey, undefined, reason);
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  #settle(sessionKey: string, answer?: ToolQuestionAnswer, error?: unknown): void {
    const pending = this.#pending.get(sessionKey);
    if (!pending) return;
    this.#pending.delete(sessionKey);
    clearTimeout(pending.timer);
    pending.request.signal.removeEventListener('abort', pending.onAbort);
    if (answer) pending.resolve(answer);
    else pending.reject(error ?? new Error('Question cancelled'));
  }

  #assertAddress(address: InteractionAddress): void {
    if (!address.sessionKey.trim() || !address.subjectId.trim()) {
      throw new TypeError('Interaction address requires sessionKey and subjectId');
    }
  }
}

function validateRequest(request: ToolQuestionRequest): void {
  if (!request.requestId.trim() || !request.question.trim()) throw new TypeError('Question identity and text are required');
  if (request.type === 'pick' && (!request.options || request.options.length < 2)) {
    throw new TypeError('Pick question requires at least two options');
  }
}

function parseAnswer(request: ToolQuestionRequest, raw: string): ToolQuestionAnswer | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (request.type === 'text') return Object.freeze({ type: 'text', value });
  if (request.type === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? Object.freeze({ type: 'number', value: number }) : undefined;
  }
  if (request.type === 'confirm') {
    if (/^(?:y|yes|true|1|是|确认|同意)$/i.test(value)) return Object.freeze({ type: 'confirm', value: true });
    if (/^(?:n|no|false|0|否|取消|拒绝)$/i.test(value)) return Object.freeze({ type: 'confirm', value: false });
    return undefined;
  }
  const options = request.options ?? [];
  const numeric = Number(value);
  const index = Number.isInteger(numeric) ? numeric - 1 : options.findIndex((option) => option === value);
  return index >= 0 && index < options.length
    ? Object.freeze({ type: 'pick', value: options[index]!, index })
    : undefined;
}

function defaultAnswer(request: ToolQuestionRequest): ToolQuestionAnswer | undefined {
  return request.defaultValue === undefined ? undefined : parseAnswer(request, request.defaultValue);
}

function formatQuestion(request: ToolQuestionRequest): string {
  const options = request.type === 'pick'
    ? `\n${(request.options ?? []).map((option, index) => `${index + 1}. ${option}`).join('\n')}`
    : request.type === 'confirm' ? '\n请回复 yes/no。' : '';
  return `${request.question}${options}`;
}

function validationMessage(request: ToolQuestionRequest): string {
  if (request.type === 'number') return '请输入有效数字。';
  if (request.type === 'confirm') return '请回复 yes 或 no。';
  if (request.type === 'pick') return `请选择 1-${request.options?.length ?? 0}。`;
  return '请输入非空回答。';
}

function boundedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return 120_000;
  return Math.max(1_000, Math.min(300_000, Math.floor(timeoutMs)));
}
