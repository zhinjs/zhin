import type { CapabilityId, PluginId } from '@zhin.js/plugin-runtime';

const componentCallBrand = 'zhin.component-call/1' as const;
const rawContentBrand = 'zhin.raw-content/1' as const;

export interface ComponentCall<TProps = unknown> {
  readonly $content: typeof componentCallBrand;
  readonly name: string;
  readonly props: TProps;
}

export interface RawContent<TPayload = unknown> {
  readonly $content: typeof rawContentBrand;
  readonly payload: TPayload;
}

export type SendContent = string | ComponentCall | RawContent | readonly SendContent[];

export function component<TProps>(name: string, props: TProps): ComponentCall<TProps> {
  if (!name.trim()) throw new TypeError('Component name cannot be empty');
  return Object.freeze({ $content: componentCallBrand, name, props });
}

export function raw<TPayload>(payload: TPayload): RawContent<TPayload> {
  return Object.freeze({ $content: rawContentBrand, payload });
}

export function isComponentCall(value: SendContent): value is ComponentCall {
  return !Array.isArray(value)
    && typeof value === 'object'
    && value !== null
    && '$content' in value
    && value.$content === componentCallBrand;
}

export function isRawContent(value: SendContent): value is RawContent {
  return !Array.isArray(value)
    && typeof value === 'object'
    && value !== null
    && '$content' in value
    && value.$content === rawContentBrand;
}

export interface IncomingMessage {
  readonly adapter: CapabilityId;
  readonly target: string;
  readonly content: string;
  readonly id?: string;
  readonly sender?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SendRequest {
  readonly adapter: CapabilityId;
  readonly target: string;
  readonly requester: PluginId;
  readonly content: SendContent;
}

export interface OutboundEnvelope {
  readonly adapter: CapabilityId;
  readonly target: string;
  readonly requester: PluginId;
  readonly generation: number;
  readonly payload: unknown;
  replace(payload: unknown): void;
}

export interface MessageGateway {
  receive(input: IncomingMessage): Promise<MessageDispatchResult>;
  send(request: SendRequest): Promise<unknown>;
}

export interface MessageDispatchResult {
  readonly matched: boolean;
  readonly command?: string;
  readonly owner?: PluginId;
  readonly value?: unknown;
}

export class Message {
  constructor(
    readonly adapter: CapabilityId,
    readonly target: string,
    readonly content: string,
    readonly generation: number,
    reply: (content: SendContent, requester?: PluginId) => Promise<unknown>,
    readonly id?: string,
    readonly sender?: string,
    readonly metadata: Readonly<Record<string, unknown>> = Object.freeze({}),
  ) {
    this.$reply = (content) => reply(content);
    this.$replyFrom = (requester, content) => reply(content, requester);
    Object.freeze(this);
  }

  readonly $reply: (content: SendContent) => Promise<unknown>;
  readonly $replyFrom: (requester: PluginId, content: SendContent) => Promise<unknown>;
}

export function createOutboundEnvelope(
  request: Omit<OutboundEnvelope, 'payload' | 'replace'>,
  initialPayload: unknown,
): OutboundEnvelope {
  let payload = initialPayload;
  return Object.freeze({
    ...request,
    get payload() { return payload; },
    replace(next: unknown) { payload = next; },
  });
}
