import { createToken } from './token.js';

/**
 * Outbound template context — conversation + incoming message metadata
 * addressable by `${path}` placeholders in outbound text.
 *
 * A placeholder is a plain property path over these fields, e.g.
 * `${sender.name}`, `${adapter}`, `${content}`, `${segments[0].type}`,
 * `${menu}`, `${command.checkin}`.
 * Nothing is evaluated: arithmetic, calls, unknown names and undefined
 * values stay in the text exactly as written. The text is scanned once;
 * substituted values (a nickname containing `${menu}`) are never expanded.
 *
 * `sender` is the person whose action this send answers: the author of the
 * incoming message, or — for a send triggered by an event without a message,
 * such as a member joining — the member the event is about, passed by the
 * sending plugin as `incoming.sender`.
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
  /**
   * The person this send answers: the incoming message's author, or the subject of the event that
   * triggered it (the member who joined). Absent for scheduled / cross-channel sends.
   */
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
  /**
   * Command prefix of the account sending this message (`conversation.endpoint`), resolved by the
   * same resolver the inbound command dispatch uses for that account; `''` when it has none.
   * Absent when no IM runtime resolves commands.
   */
  readonly prefix?: string;
  /**
   * The command menu entry of the sending account: its prefix plus the menu keyword
   * (`menuKeyword`, or the default keyword). Absent when the menu is turned off.
   */
  readonly menu?: string;
  /**
   * Written forms of the sending Plugin's own commands on the sending account, prefix included:
   * `${command.checkin}`, `${command.group.kick}`. Keys are the command's static path segments,
   * with `-` written as `_` (`keyword-add` → `${command.keyword_add}`); a segment that starts with a
   * digit is left out. Only the requester's commands are listed. A command that also has
   * subcommands is reachable only through its subcommands. Unknown paths stay in the text as written.
   */
  readonly command?: TemplateCommandPaths;
}

/** Plain data: each key is a command path segment, each leaf the command as the user types it. */
export interface TemplateCommandPaths {
  readonly [segment: string]: string | TemplateCommandPaths;
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
