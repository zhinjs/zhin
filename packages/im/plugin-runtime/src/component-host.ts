import { createToken } from './token.js';

/**
 * Outbound template context — conversation + incoming message metadata
 * addressable by `${path}` placeholders in outbound text.
 *
 * A placeholder is a plain property path over these fields, e.g.
 * `${sender.name}`, `${adapter}`, `${content}`, `${segments[0].type}`.
 * Nothing is evaluated: arithmetic, calls, unknown names and undefined
 * values stay in the text exactly as written.
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
 * Thin Host Resource for Plugin Runtime outbound template substitution.
 * Replaces `${path}` placeholders by whitelist path lookup over the
 * `TemplateContext`; it never evaluates expressions.
 * The Host keeps render authority inside the active Runtime operation.
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
