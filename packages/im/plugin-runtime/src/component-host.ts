import { createToken } from './token.js';

/**
 * Outbound template context — the sending account, the conversation, the person answered and the
 * incoming message, addressable by `${path}` placeholders in outbound text.
 *
 * Every placeholder has at least two segments (`${bot.menu}`, `${sender.name}`,
 * `${message.content}`, `${command.checkin}`): configuration strings are environment-expanded at
 * load time, where a single name such as `${NAME}` is taken as an environment variable, while a
 * dotted path passes through unchanged and reaches the outbound renderer.
 *
 * Nothing is evaluated: arithmetic, calls, unknown names and undefined values stay in the text
 * exactly as written. The text is scanned once; substituted values (a nickname containing
 * `${bot.menu}`) are never expanded.
 */
export interface TemplateContext {
  /** The account sending this message (`conversation.endpoint`). */
  readonly bot: TemplateBot;
  readonly conversation: Readonly<{
    /** Conversation kind: 'private' | 'group' | 'channel'. */
    readonly kind: string;
    /** Native conversation id. */
    readonly id: string;
  }>;
  /**
   * The person this send answers: the incoming message's author, or — for a send triggered by an
   * event without a message, such as a member joining — the subject of the event, passed by the
   * sending plugin as `incoming.sender`. Absent for scheduled / cross-channel sends.
   */
  readonly sender?: Readonly<{
    readonly id: string;
    readonly name?: string;
    readonly roles?: readonly string[];
  }>;
  /** The incoming message this send answers; absent for scheduled / cross-channel sends. */
  readonly message?: Readonly<{
    /** Plain text content (empty for an event without a message). */
    readonly content: string;
    /** Structured message segments (images, mentions, quotes, etc.). */
    readonly segments?: readonly Readonly<{ type: string; data?: Record<string, unknown> }>[];
    /** Platform native message id. */
    readonly id?: string;
    /** Arrival timestamp in ms. */
    readonly timestamp: number;
    /** Whether the bot was @mentioned. */
    readonly mentioned?: boolean;
  }>;
  /**
   * Written forms of the sending Plugin's own commands on the sending account, prefix included:
   * `${command.checkin}`, `${command.group.kick}`. Keys are the command's static path segments,
   * with `-` written as `_` (`keyword-add` → `${command.keyword_add}`); a segment that starts with a
   * digit is left out. Only the requester's commands are listed. A command that also has
   * subcommands is reachable only through its subcommands. Unknown paths stay in the text as written.
   */
  readonly command?: TemplateCommandPaths;
}

/** `${bot.*}`: the account that sends the message. */
export interface TemplateBot {
  /** Adapter name (e.g. 'qq', 'sandbox'). */
  readonly adapter: string;
  /** Endpoint capability id of the sending account (`conversation.endpoint.id`). */
  readonly endpoint: string;
  /**
   * Endpoint instance name as the platform reports it (an ICQQ uin, a sandbox bot name); only
   * when the send answers an incoming message that carries it.
   */
  readonly endpointId?: string;
  /**
   * Command prefix of the sending account, resolved by the same resolver the inbound command
   * dispatch uses for that account; `''` when it has none. Absent when no IM runtime resolves commands.
   */
  readonly prefix?: string;
  /**
   * The command menu entry of the sending account: its prefix plus the menu keyword
   * (`menuKeyword`, or the default keyword). Absent when the menu is turned off.
   */
  readonly menu?: string;
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
