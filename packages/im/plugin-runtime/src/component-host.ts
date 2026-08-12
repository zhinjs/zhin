import { createToken } from './token.js';

/**
 * Outbound template context — conversation + incoming message metadata
 * available as top-level variables inside `${expr}` template expressions.
 *
 * Templates can reference e.g. `${sender.name}`, `${adapter}`,
 * `${content}`, `${messageId}`, `${timestamp}`.
 */
export interface TemplateContext {
  /** Adapter feature name (e.g. 'qq', 'sandbox'). */
  readonly adapter: string;
  /** Endpoint instance id. */
  readonly endpoint: string;
  /** Conversation kind: 'private' | 'group' | 'channel'. */
  readonly kind: string;
  /** Native conversation id. */
  readonly conversationId: string;
  /** Sender info (absent for scheduled / cross-channel sends). */
  readonly sender?: Readonly<{
    readonly id: string;
    readonly name?: string;
    readonly roles?: readonly string[];
  }>;
  /** Incoming message text content. */
  readonly content?: string;
  /** Structured message segments (images, mentions, quotes, etc.). */
  readonly segments?: readonly Readonly<{ type: string; data?: Record<string, unknown> }>[];
  /** Platform native message id. */
  readonly messageId?: string;
  /** Message arrival timestamp in ms. */
  readonly timestamp?: number;
  /** Endpoint instance name (e.g. ICQQ uin, sandbox bot name). */
  readonly endpointId?: string;
  /** Whether the bot was @mentioned. */
  readonly mentioned?: boolean;
}

/**
 * Thin Host Resource for Plugin Runtime outbound template compilation.
 * Evaluates `${expr}` template expressions in a sandboxed VM context
 * (same security boundary as the legacy ComponentFeature pipeline).
 *
 * Implemented by the CLI Host; absent when not wired — consumers must
 * pass text through unchanged.
 */
export interface ComponentHost {
  compileTemplate(text: string, context: TemplateContext): string;
}

export const componentHostToken = createToken<ComponentHost>(
  'zhin.component.host',
  'Plugin Runtime template compilation host',
);
