import {
  SegmentMatcher,
  TypeMatcherRegistry,
  type MessageSegment,
} from 'segment-matcher';
import {
  disabledFeatureOwners,
  htmlRendererToken,
  resolveFeatureTargetKey,
  formatList,
  isLocale,
  projectLocale,
  type CapabilityId,
  type CapabilitySlot,
  type PluginId,
  type RuntimeSnapshot,
  type Locale,
} from '@zhin.js/plugin-runtime';
import type { UserInteractionFactory } from '@zhin.js/im-contract';
import { bindOperationInput, readOperationInputResources, readOperationInputSnapshot, type CapabilityOperationFactory } from '@zhin.js/feature-kit';
import {
  describeDeniedPermit,
  parsePermitName,
  permissionHostToken,
  type PermissionHost,
} from '@zhin.js/permission';
import { commandAdapterMatches, toCommandPermissionSubject } from './permission-explanation.js';
import { commandUsage, commandHelp, parseCommandArguments, requestsCommandHelp, commandValidationIssue, type CommandValidationIssue } from './arguments.js';
import { commandDescription, commandMessages } from './messages.js';
import { userFacingErrorText, userFacingRefusalReason } from './user-facing-error.js';
import { rankCommandSuggestions, rankDisplayNameSuggestions, resolveCommandSuggestionConfig, type CommandNameCandidate, type DisplayNameCandidate } from './command-suggestion.js';
export type { CommandSuggestionConfig } from './command-suggestion.js';
import { MENU_PAGE_SIZE, readMenuAppearance, renderCommandMenu, type CommandMenuSegment, type CommandMenuEntry, type CommandMenuAppearance } from './command-menu.js';
export type { CommandMenuEntry, CommandMenuAppearance } from './command-menu.js';
import { admitCommandExecution, admitDirectCommandExecution } from './execution-runtime.js';
import { CommandExecutionLimitedError, normalizeExecutionPolicy, type CommandExecutionLimit } from './execution-policy.js';
export { CommandExecutionLimitedError } from './execution-policy.js';
import {
  createCommandContext,
  resolveCommandSession,
  type CommandDefinition,
  type CommandParameterDefinition,
  type CommandParameterType,
  type CommandSegment,
  type CommandDynamicValue,
  resolveDynamicParams,
} from './definition.js';

export interface CommandParameterDescriptor extends CommandParameterDefinition {
  readonly required: boolean;
}

export interface CommandDescriptor {
  readonly id: CapabilityId;
  readonly owner: PluginId;
  readonly name: string;
  readonly description?: string;
  readonly adapter?: string;
  readonly source: string;
  readonly parameters: readonly CommandParameterDescriptor[];
  readonly usage: string;
  readonly options: NonNullable<CommandDefinition['options']>;
  readonly alias?: readonly string[];
  readonly permit?: readonly string[];
  readonly execution?: CommandDefinition['execution'];
  /** shortcut 触发键列表（不含预填 params）。 */
  readonly shortcut?: readonly string[];
  /** `match` 正则的字面形式（如 `/^demo$/i`）。 */
  readonly match?: string;
}

/** One registration taking part in a route conflict (#1250). */
export interface CommandRouteClaimant {
  readonly owner: PluginId;
  /** Plugin instance key (its configuration block name); the owner id when the tree has no node. */
  readonly plugin: string;
  readonly packageName?: string;
  /** The project's Root plugin (its own `commands/`); it has no plugin page of its own. */
  readonly root?: true;
  readonly capability: CapabilityId;
  /** Display name of the command (with `commandNamespace` and parameter placeholders). */
  readonly command: string;
  /** Plugin-local static path, as `disabledCommands` takes it (e.g. `rank`, `netease login`). */
  readonly localPath: string;
  readonly source: string;
  /** Which route of the command: its primary route, one alias or one shortcut. */
  readonly kind: 'command' | 'alias' | 'shortcut';
  /** The alias or shortcut text (`alias` / `shortcut` only). */
  readonly entry?: string;
}

/**
 * A route two plugins claim (#1250 duplicate-command-route-crashes-instance). Command names claim
 * first, then aliases, then shortcuts; within each the earlier plugin (tree order) keeps the
 * route. The loser is skipped: the whole command when its name collides, only the alias /
 * shortcut otherwise. Collisions inside one plugin are not reported here: they throw.
 */
export interface CommandRouteConflict {
  /** Route shape both claim: words separated by spaces, `$` / `$*` / `$+` for parameters. */
  readonly route: string;
  readonly skipped: CommandRouteClaimant;
  readonly kept: CommandRouteClaimant;
  /**
   * The keeper's plugin comes after the skipped one's: a later plugin's command took an alias or
   * shortcut an earlier plugin had, so text users knew now runs another plugin's command.
   */
  readonly takenByLater?: true;
}

/** One dispatch reads the caller's exact operation generation and presentation. */
export interface CommandDispatchRequest {
  readonly input: CommandMatchInput;
  readonly source?: unknown;
  readonly interactionFactory?: UserInteractionFactory;
  readonly commandPrefix?: string;
  readonly snapshot?: RuntimeSnapshot;
  readonly operation?: CapabilityOperationFactory;
  readonly locale?: Locale;
}
/** Presentation and generation shared across one menu lookup/render operation. */
interface CommandMenuContext {
  readonly commandPrefix: string;
  readonly keyword: string;
  readonly snapshot: RuntimeSnapshot;
  readonly locale: Locale;
  /** The requesting message: the menu lists only commands it may run (ADR 0056 §5). */
  readonly source?: unknown;
}
interface CommandMenuSelection { readonly pluginKey?: string; readonly page?: number }

export interface CommandDispatchResult {
  readonly matched: boolean;
  readonly status: 'unmatched' | 'invalid' | 'denied' | 'limited' | 'executed';
  readonly limit?: CommandExecutionLimit;
  readonly issues?: readonly CommandValidationIssue[];
  readonly help?: string;
  readonly command?: string;
  readonly owner?: PluginId;
  readonly value?: unknown;
  readonly menu?: CommandMenuPage;
  /**
   * `denied` only: the first unmet permit and a one-sentence reason for the sender (e.g. 「机器人不是本群管理员」).
   * Undefined when no Permission host / source answered.
   */
  readonly denial?: Readonly<{ permit: string; reason: string }>;
  /**
   * `executed` only: the command refused with a `UserFacingError`, whose text is `value`
   * (the reply). Lets observers tell an expected refusal from a successful run; the status stays
   * `executed` so existing consumers keep replying as before.
   */
  readonly refused?: true;
  /** With `refused`: the error's closed refusal code ({@link UserFacingError.reason}), when it has one. */
  readonly refusalReason?: string;
}

/** Semantic menu navigation; the IM composition layer supplies platform controls. */
export interface CommandMenuNavigation {
  readonly keyword: string;
  readonly pluginKey?: string;
  readonly page: number;
  readonly pages: number;
}

/** Immutable page data; presentation cannot change the catalog or execute commands. */
export interface CommandMenuPage extends CommandMenuNavigation {
  readonly locale: Locale;
  readonly title: string;
  readonly commands: readonly CommandMenuEntry[];
  readonly plugins: readonly CommandMenuEntry[];
  readonly commandTotal: number;
  readonly pluginTotal: number;
  readonly hint?: string;
  readonly text: string;
  readonly appearance: CommandMenuAppearance;
}

interface CommandMenuResult {
  readonly value: string | CommandMenuSegment;
  readonly menu?: CommandMenuPage;
}

interface CommandRecord extends CommandDescriptor {
  readonly slot: Readonly<CapabilitySlot<CommandDefinition>>;
  readonly segments: readonly string[];
  /** The owner's `commandNamespace` words (empty without one). */
  readonly namespace: readonly string[];
  readonly preferredSegments: Readonly<Partial<Record<Locale, readonly string[]>>>;
  readonly parameter?: CommandParameterDefinition;
  readonly pattern?: RegExp;
}

interface CommandRoute {
  readonly record: CommandRecord;
  readonly segments: readonly string[];
  readonly matcher: SegmentMatcher;
  readonly literalMatcher?: SegmentMatcher;
  readonly kind: 'primary' | 'alias';
}

interface ShortcutEntry {
  readonly record: CommandRecord;
  readonly params: Readonly<Record<string, CommandDynamicValue>>;
}

interface CommandMatch {
  readonly command: CommandRecord;
  readonly params: Readonly<Record<string, CommandDynamicValue>>;
  readonly remaining: readonly Readonly<CommandSegment>[];
  readonly helpRequested: boolean;
  readonly regex?: RegExpExecArray;
}

export type CommandMatchInput = string | readonly Readonly<CommandSegment>[];

const segmentFields = {
  text: 'text',
  mention: 'target',
  at: ['target', 'user_id', 'qq'],
  face: 'id',
  image: (segment: MessageSegment) =>
    segment.data.media ?? segment.data.file ?? segment.data.url ?? segment.data.src,
  reply: ['message_id', 'reply_id', 'id'],
  forward: ['forward_id', 'res_id', 'message_id', 'id'],
  dice: 'result',
  rps: 'result',
};

export interface CommandMenuConfig {
  /** Omission selects the built-in keyword for each operation's language. */
  readonly keyword?: string;
}

/** Adapter capabilities' feature id; compared as a string so Command stays independent of the adapter package. */
const ADAPTER_FEATURE = 'zhin.adapter';
const DEFAULT_MENU_KEYWORDS = new Set(['菜单', '帮助', 'help', 'menu']);

/** Permit kinds that are conditions on the sender (zhin role, platform standing, user id). */
const SENDER_PERMIT_KINDS: ReadonlySet<string> = new Set(['role', 'platform', 'platform-role', 'platform-permission', 'user']);

/**
 * Whether a permit is a condition on the sender rather than on the place (`group()`, `adapter(…)`) or
 * the Bot (`bot:admin`). Custom (non-builtin) permits cannot be told apart and count as the sender's.
 */
function deniesSender(permit: string): boolean {
  const parsed = parsePermitName(permit);
  return parsed ? SENDER_PERMIT_KINDS.has(parsed.kind) : true;
}

export class CommandIndex {
  readonly $projection = 'zhin.command-index/1' as const;
  readonly #slots: readonly Readonly<CapabilitySlot<CommandDefinition>>[];
  readonly #commands: readonly CommandRecord[];
  readonly #endpointGated = new Map<string, CommandIndex>();
  readonly #routes: readonly CommandRoute[];
  readonly #shortcuts: ReadonlyMap<string, ShortcutEntry>;
  readonly #menu?: CommandMenuConfig;
  readonly #conflicts: readonly CommandRouteConflict[];

  constructor(
    slots: readonly Readonly<CapabilitySlot<CommandDefinition>>[],
    private readonly snapshot: RuntimeSnapshot,
    menu?: CommandMenuConfig,
  ) {
    this.#menu = menu;
    this.#slots = slots;
    const commands: CommandRecord[] = [];
    const routes: CommandRoute[] = [];
    const occupancy = new Map<string, CommandRouteClaimant>();
    const shortcuts = new Map<string, ShortcutEntry>();
    const conflicts: CommandRouteConflict[] = [];

    const ranks = pluginRanks(this.snapshot);
    const rank = (owner: PluginId) => ranks.get(owner) ?? Number.MAX_SAFE_INTEGER;

    // #1250 duplicate-command-route-crashes-instance: a route claimed by two *plugins* is kept by
    // the earlier claim and reported; it never fails the whole projection (and so the instance).
    const claim = (keys: readonly string[], claimant: CommandRouteClaimant): boolean => {
      let conflict: { readonly key: string; readonly kept: CommandRouteClaimant } | undefined;
      for (const key of keys) {
        for (const [existing, kept] of occupancy) {
          if (routeShapesOverlap(key, existing)) { conflict = { key, kept }; break; }
        }
        if (conflict) break;
      }
      if (conflict) {
        const { key, kept } = conflict;
        conflicts.push(Object.freeze({
          route: key, skipped: claimant, kept,
          ...(rank(kept.owner) > rank(claimant.owner) ? { takenByLater: true as const } : {}),
        }));
        return false;
      }
      for (const key of keys) occupancy.set(key, claimant);
      return true;
    };

    interface RouteClaim {
      readonly keys: readonly string[];
      readonly claimant: CommandRouteClaimant;
    }
    interface Declared {
      readonly slot: Readonly<CapabilitySlot<CommandDefinition>>;
      readonly namespace: readonly string[];
      readonly primarySegments: string[];
      readonly parameter: CommandParameterDefinition | undefined;
      readonly name: string;
      readonly primary: RouteClaim;
      readonly aliases: readonly (RouteClaim & { readonly entry: string; readonly segments: readonly string[] })[];
      readonly shortcuts: readonly (RouteClaim & { readonly trigger: string; readonly key: string; readonly prefill: Readonly<Record<string, CommandDynamicValue>> })[];
    }
    // Pass 0: every route each command declares (primary, aliases, shortcuts).
    const declared: Declared[] = [];
    const disabledByOwner = new Map<PluginId, readonly string[]>();
    for (const slot of registrationOrder(slots, ranks)) {
      let disabled = disabledByOwner.get(slot.owner);
      if (!disabled) {
        disabled = disabledCommands(this.snapshot, slot.owner);
        disabledByOwner.set(slot.owner, disabled);
      }
      if (isDisabledCommand(slot.localName, disabled)) continue;
      const namespace = commandNamespace(this.snapshot, slot.owner);
      const primarySegments = [...namespace, ...runtimeSegments(slot.localName)];
      const parameter = slot.definition.$parameter;
      assertParameterSegment(primarySegments, parameter, slot.source);
      const name = displayName(primarySegments, parameter);
      const claimant = (kind: CommandRouteClaimant['kind'], entry?: string): CommandRouteClaimant =>
        commandClaimant(this.snapshot, slot, name, kind, entry);
      const aliases = (normalizeAliasList(slot.definition.alias) ?? []).map((aliasText) => {
        const aliasSegments = [...namespace, ...aliasRuntimeSegments(
          aliasText,
          primarySegments.slice(namespace.length),
        )];
        assertParameterSegment(aliasSegments, parameter, `${slot.source} alias ${JSON.stringify(aliasText)}`);
        return {
          entry: aliasText,
          segments: Object.freeze(aliasSegments),
          keys: [...new Set([occupancyKey(aliasSegments, parameter), ...declaredRouteShapes(aliasSegments, slot.definition)])],
          claimant: claimant('alias', aliasText),
        };
      });
      const shortcuts = Object.entries(slot.definition.shortcut ?? {}).map(([rawTrigger, prefill]) => {
        const trigger = [...namespace, ...splitCommand(rawTrigger)].join(' ');
        return { trigger, key: rawTrigger.trim(), prefill, keys: [trigger], claimant: claimant('shortcut', trigger) };
      });
      declared.push({
        slot, namespace, primarySegments, parameter, name,
        primary: { keys: [...new Set([occupancyKey(primarySegments, parameter), ...declaredRouteShapes(primarySegments, slot.definition)])], claimant: claimant('command') },
        aliases,
        shortcuts,
      });
    }

    // Two routes of the same plugin colliding is that plugin's own authoring error: it throws, so
    // the plugin's tests catch it. Checked per plugin against its own routes only, so the result
    // never depends on which other plugins are loaded, enabled or gated for an endpoint.
    assertNoSamePluginOverlap(declared.flatMap((entry) => [entry.primary, ...entry.aliases, ...entry.shortcuts]));

    interface Admitted extends Declared {
      readonly aliasRoutes: { readonly entry: string; readonly segments: readonly string[] }[];
      readonly shortcutEntries: { readonly trigger: string; readonly key: string; readonly prefill: Readonly<Record<string, CommandDynamicValue>> }[];
    }
    const admitted: Admitted[] = [];
    // Pass 1: primary routes. A primary route taken by an earlier plugin skips the later command
    // as a whole (its aliases and shortcuts included).
    for (const entry of declared) {
      if (!claim(entry.primary.keys, entry.primary.claimant)) continue;
      admitted.push({ ...entry, aliasRoutes: [], shortcutEntries: [] });
    }
    // Pass 2: aliases, after every primary route, so an alias never costs another command its
    // name; a taken alias skips only that alias.
    for (const entry of admitted) {
      for (const alias of entry.aliases) {
        if (!claim(alias.keys, alias.claimant)) continue;
        entry.aliasRoutes.push({ entry: alias.entry, segments: alias.segments });
      }
    }
    // Pass 3: shortcuts; a taken trigger skips only that shortcut.
    for (const entry of admitted) {
      for (const shortcut of entry.shortcuts) {
        if (!claim(shortcut.keys, shortcut.claimant)) continue;
        entry.shortcutEntries.push({ trigger: shortcut.trigger, key: shortcut.key, prefill: shortcut.prefill });
      }
    }

    for (const { slot, namespace, primarySegments, parameter, name, aliasRoutes, shortcutEntries } of admitted) {
      const alias = aliasRoutes.length > 0 ? Object.freeze(aliasRoutes.map(route => route.entry)) : undefined;
      const routedAliases = new Set(alias ?? []);
      const permit = slot.definition.permit
        ? Object.freeze([...slot.definition.permit])
        : undefined;
      const shortcutKeys = shortcutEntries.length > 0
        ? Object.freeze(shortcutEntries.map(entry => entry.key))
        : undefined;

      const execution = normalizeExecutionPolicy(slot.definition.execution);
      const record: CommandRecord = Object.freeze({
        id: slot.id,
        owner: slot.owner,
        name,
        description: slot.definition.description,
        ...(execution ? { execution } : {}),
        ...(slot.definition.adapter ? { adapter: slot.definition.adapter } : {}),
        source: slot.source,
        usage: commandUsage(name, slot.definition),
        options: Object.freeze({ ...slot.definition.options }),
        parameters: Object.freeze([
          ...Object.entries(slot.definition.params ?? {}).map(([key, schema]) => ({
            name: key, ...schema, ...(parameter?.name === key ? parameter : {}), defaultValue: schema.default,
            required: parameter?.name === key ? isRequiredParameter(parameter) : !schema.optional && schema.default === undefined,
          })),
          ...(parameter && !Object.hasOwn(slot.definition.params ?? {}, parameter.name)
            ? [{ ...parameter, required: isRequiredParameter(parameter) }] : []),
        ]),
        ...(alias ? { alias } : {}),
        ...(permit ? { permit } : {}),
        ...(shortcutKeys && shortcutKeys.length > 0 ? { shortcut: shortcutKeys } : {}),
        ...(slot.definition.match ? { match: String(slot.definition.match), pattern: slot.definition.match } : {}),
        slot,
        segments: Object.freeze(primarySegments),
        namespace,
        // A preferred alias that was skipped (taken by another command) is not displayed.
        preferredSegments: Object.freeze(Object.fromEntries(Object.entries(slot.definition.preferredAliasI18n ?? {})
          .filter(([, entry]) => routedAliases.has(splitCommand(entry).join(' ')))
          .map(([locale, entry]) =>
            [locale, Object.freeze([...namespace, ...aliasRuntimeSegments(entry, primarySegments.slice(namespace.length))])]))),
        parameter,
      });

      routes.push({
        record,
        segments: primarySegments,
        matcher: new SegmentMatcher(matcherPattern(primarySegments, parameter), segmentFields),
        literalMatcher: compileLiteralMatcher(primarySegments, parameter),
        kind: 'primary',
      });
      for (const route of aliasRoutes) {
        routes.push({
          record,
          segments: route.segments,
          matcher: new SegmentMatcher(matcherPattern(route.segments, parameter), segmentFields),
          literalMatcher: compileLiteralMatcher(route.segments, parameter),
          kind: 'alias',
        });
      }
      for (const { trigger, prefill } of shortcutEntries) {
        shortcuts.set(trigger, {
          record,
          params: Object.freeze(resolveShortcutParams(
            slot.definition,
            prefill,
            `${slot.source} shortcut ${JSON.stringify(trigger)}`,
          )),
        });
      }

      commands.push(record);
    }

    this.#conflicts = Object.freeze(conflicts);
    this.#commands = Object.freeze(commands.sort(compareRecords));
    this.#routes = Object.freeze(routes.sort(compareRoutes));
    this.#shortcuts = shortcuts;
  }

  /**
   * Routes left out because an earlier registration already holds them (#1250): a skipped command
   * (its primary route is taken), or a single skipped alias / shortcut. Empty when none collide.
   */
  conflicts(): readonly CommandRouteConflict[] {
    return this.#conflicts;
  }

  list(locale: Locale = 'zh-CN'): readonly CommandDescriptor[] {
    return this.#commands.map(record => ({ ...toDescriptor(record),
      name: commandDisplayName(record, locale), usage: commandUsage(commandDisplayName(record, locale), record.slot.definition),
      description: commandDescription(record.slot.definition, locale),
      parameters: record.parameters.map(parameter => ({ ...parameter, description: commandDescription(parameter, locale) })),
      options: Object.freeze(Object.fromEntries(Object.entries(record.options).map(([key, schema]) =>
        [key, { ...schema, description: commandDescription(schema, locale) }]))),
    }));
  }

  /** Resolve a local static route without executing parameters, permission checks or commands. */
  formatCommand(owner: PluginId, localPath: string, prefix: string | undefined, locale: Locale = 'zh-CN'): string | undefined {
    if (prefix === undefined || typeof localPath !== 'string') return undefined;
    const path = localPath.trim().split(/\s+/u).filter(Boolean).join(' ');
    if (!path) return undefined;
    const command = this.#commands.find(record => record.owner === owner
      && record.slot.localName.split('/').filter(segment => !segment.startsWith('$')).join(' ') === path);
    return command ? prefix + commandDisplaySegments(command, locale).filter(segment => !segment.startsWith('$')).join(' ') : undefined;
  }

  /** Return the configured menu entry only when the calling environment is known. */
  formatMenu(prefix: string | undefined, locale: Locale): string | undefined {
    if (prefix === undefined || !this.#menu) return undefined;
    return prefix + (this.#menu.keyword ?? commandMessages(locale, 'menuKeyword'));
  }

  has(name: string): boolean {
    try {
      return this.#match(name, true) !== undefined;
    } catch (error) {
      if (error instanceof CommandParameterValueError) return false;
      throw error;
    }
  }

  /**
   * @internal Whether `input` (prefix already removed) routes to a command: the menu keyword, a
   * shortcut, a route (also one with invalid arguments, which answers with its usage) or a `match`
   * pattern. Nothing runs and no permission is checked (#1250: a pending prompt ends when its
   * sender sends a command meanwhile). With `source`, a command restricted to another adapter does
   * not route, exactly as {@link dispatch} treats it.
   */
  routes(input: CommandMatchInput, locale: Locale = 'zh-CN', source?: unknown): boolean {
    const text = typeof input === 'string' ? input.trim() : exactMessageText(input);
    if (this.#menu && text !== undefined) {
      const keyword = this.#menu.keyword ?? commandMessages(locale, 'menuKeyword');
      const first = (text.split(/\s/u)[0] ?? '').replace(/^\//u, '').toLowerCase();
      if (text === keyword || text.startsWith(`${keyword} `)
        || (this.#menu.keyword === undefined && DEFAULT_MENU_KEYWORDS.has(first))) return true;
    }
    try {
      // Same resolution order as `dispatch`: the routed command (or the invalid-argument candidate)
      // decides, and its adapter restriction applies when the source is known.
      const shortcut = this.#matchShortcut(input);
      const command = shortcut?.record ?? this.#match(input, false)?.command ?? this.#matchPattern(input)?.command
        ?? this.#invalidRoute(input);
      if (!command) return false;
      return source === undefined || commandAdapterMatches(command, source);
    } catch (error) {
      if (error instanceof CommandParameterValueError) return false;
      throw error;
    }
  }

  /**
   * Near-miss names for text that did not route (issue #1250): display names (with
   * `commandPrefix`) of commands the sender may run whose name or alias resembles the
   * start of `text`. Root config `commandSuggestion` tunes or disables it (`false`).
   * `explicitPrefix` (default: `commandPrefix` is non-empty) says the message carried the
   * command prefix; without it only short, command-like text is matched (no namespace matches).
   */
  async suggest(text: string, { source, commandPrefix = '', explicitPrefix = commandPrefix.length > 0, snapshot: operationSnapshot = this.snapshot, locale: localeOverride }: {
    readonly source?: unknown; readonly commandPrefix?: string; readonly explicitPrefix?: boolean; readonly snapshot?: RuntimeSnapshot; readonly locale?: Locale;
  } = {}): Promise<readonly string[]> {
    const rootConfig = operationSnapshot.config.get(operationSnapshot.root) as { commandSuggestion?: unknown } | undefined;
    const config = resolveCommandSuggestionConfig(rootConfig?.commandSuggestion);
    if (!config.enabled) return [];
    const candidates: CommandNameCandidate<CommandRecord>[] = this.#routes.map(route => ({
      value: route.record,
      words: route.segments.filter(segment => !segment.startsWith('$')),
      arity: route.record.parameters.length + Object.keys(route.record.options).length,
    }));
    const byName = rankCommandSuggestions(text, candidates, { ...config, limit: Number.MAX_SAFE_INTEGER }, { explicitPrefix });
    // #1250: nothing resembles a command name — compare with the plugins' display names, which
    // is what menus and help call a game (`地牢探险` → the plugin shown as `地牢远征`).
    const ranked = byName.length > 0 ? byName
      : rankDisplayNameSuggestions(text, this.#displayNameCandidates(operationSnapshot), { ...config, limit: Number.MAX_SAFE_INTEGER }, { explicitPrefix });
    const locale = localeOverride ?? commandLocale(source, operationSnapshot);
    const names: string[] = [];
    for (const record of ranked) {
      if (names.length >= config.limit) break;
      // Without a sender nothing proves a permit, so gated commands are never revealed.
      if (source === undefined ? (record.permit?.length ?? 0) > 0 : !(await this.#listable(record, source, operationSnapshot))) continue;
      names.push(`${commandPrefix}${commandSuggestionName(record, locale)}`);
    }
    return names;
  }

  /** Each plugin's display names, pointing at its entry command (the shortest route it owns). */
  #displayNameCandidates(snapshot: RuntimeSnapshot): DisplayNameCandidate<CommandRecord>[] {
    const entry = new Map<PluginId, CommandRecord>();
    for (const record of this.#commands) {
      const current = entry.get(record.slot.owner);
      if (!current || record.segments.length < current.segments.length) entry.set(record.slot.owner, record);
    }
    return [...entry].flatMap(([owner, record]) => {
      const metadata = snapshot.tree.get(owner)?.metadata;
      const names = [metadata?.displayName, ...Object.values(metadata?.displayNameI18n ?? {})]
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
      return names.length > 0 ? [{ value: record, names }] : [];
    });
  }

  /** Localized "no such command, did you mean …" reply, or `undefined` when nothing is similar. */
  async suggestReply(text: string, options: Parameters<CommandIndex['suggest']>[1] = {}): Promise<string | undefined> {
    const names = await this.suggest(text, options);
    if (names.length === 0) return undefined;
    const locale = options.locale ?? commandLocale(options.source, options.snapshot ?? this.snapshot);
    return commandMessages(locale, 'didYouMean', { commands: formatList(locale, names) });
  }

  async execute(name: string, args: readonly string[] = [], operationSnapshot: RuntimeSnapshot = this.snapshot): Promise<unknown> {
    const locale = commandLocale(undefined, operationSnapshot);
    const match = this.#match(name, false);
    if (!match) {
      this.#diagnoseParameter(name);
      throw new Error(`Unknown Command: ${name}`);
    }
    if ((await this.#permitDenial(match.command, undefined, operationSnapshot)) !== undefined) throw new Error(`Permission denied for Command: ${match.command.name}`);
    const definition = match.command.slot.definition;
    const supplied = [...match.remaining, ...(args.length > 0 ? [{ type: 'text', data: { text: args.join(' ') } }] : [])];
    const parsed = parseCommandArguments(definition, supplied, resolveDynamicParams(match.params, undefined), {}, locale);
    if (parsed.issues.length > 0) throw new CommandArgumentValidationError(parsed.issues, commandHelp(commandDisplayName(match.command, locale), definition, '', locale));
    // No inbound source: execution policy applies per command, never as a blanket refusal.
    const admission = admitDirectCommandExecution(match.command.slot.id, match.command.execution, operationSnapshot);
    if (admission.limit) throw new CommandExecutionLimitedError(admission.limit);
    try {
      return await definition.execute(createCommandContext({ snapshot: operationSnapshot, ownerId: match.command.slot.owner,
        adapter: definition.adapter, presentation: { locale } }, {
        args: textArgs(parsed.remaining), params: parsed.params, segments: parsed.remaining, options: parsed.options,
      }));
    } finally {
      admission.release();
    }
  }

  async dispatch(request: CommandDispatchRequest): Promise<CommandDispatchResult> {
    const sourceSnapshot = request.snapshot === undefined ? this.#sourceSnapshot(request.source) : undefined;
    // Without an explicit factory, a source that carries its own operation (a framework Message) brings
    // that operation's resources — also with an explicit `snapshot` that is the source's own, so both
    // ways of dispatching a message give the command the same resources (#1250 第 84 批).
    const sourceResources = request.operation ? undefined
      : sourceSnapshot ?? (request.snapshot !== undefined && readOperationInputSnapshot(request.source) === request.snapshot
        ? request.snapshot : undefined);
    if (sourceSnapshot) {
      // ADR 0050: a Plugin switched off for this message's endpoint has no commands there, also when a
      // middleware/handler dispatches through the raw projection (Core's dispatcher passes a gated index).
      const gated = this.#gatedForEndpoint(request.source, sourceSnapshot);
      if (gated !== this) return gated.#dispatch({ ...request, snapshot: sourceSnapshot }, sourceResources);
    }
    return this.#dispatch(sourceSnapshot ? { ...request, snapshot: sourceSnapshot } : request, sourceResources);
  }

  /**
   * `sourceResources`: the snapshot of the source's own operation when its resources are read from the
   * source (no explicit factory). They are read from the author-bound view of the source (#1250 第 84
   * 批): its factory opens Host resources only for that very author, and delegated (`delegatedFrom`) when the view was
   * bound from a plugin author (a plugin dispatching a Root command), so the Host withholds Root-only
   * dispatch authority — the command still runs. Nothing here refuses the dispatch.
   */
  async #dispatch(request: CommandDispatchRequest, sourceResources: RuntimeSnapshot | undefined): Promise<CommandDispatchResult> {
    const { input, source, interactionFactory, commandPrefix, locale: localeOverride } = request;
    const operationSnapshot = request.snapshot ?? this.snapshot;
    const locale = localeOverride ?? commandLocale(source, operationSnapshot);
    const prefix = commandPrefix ?? '';
    if (this.#menu) {
      const keyword = this.#menu.keyword ?? commandMessages(locale, 'menuKeyword');
      const menuResult = await this.#dispatchMenu(input, { commandPrefix: prefix, snapshot: operationSnapshot, locale, keyword, source });
      if (menuResult !== undefined) {
        return Object.freeze({
          matched: true,
          status: 'executed',
          command: keyword,
          owner: operationSnapshot.root,
          ...menuResult,
        });
      }
    }
    const shortcut = this.#matchShortcut(input);
    const routed = shortcut
      ? { command: shortcut.record, params: shortcut.params, remaining: Object.freeze([]), helpRequested: false }
      : this.#match(input, false);
    const match = routed ? withPattern(routed, input) : this.#matchPattern(input);
    if (!match) {
      const candidate = this.#invalidRoute(input);
      if (!candidate) {
        const group = await this.#groupHelp(input, { prefix, source, snapshot: operationSnapshot, locale });
        return group ?? Object.freeze({ matched: false, status: 'unmatched' });
      }
      if (!commandAdapterMatches(candidate, source)) return Object.freeze({ matched: false, status: 'unmatched' });
      const candidateDenial = await this.#permitDenial(candidate, source, operationSnapshot);
      if (candidateDenial !== undefined) return this.#denied(candidate, candidateDenial, locale);
      const help = commandHelp(commandDisplayName(candidate, locale), candidate.slot.definition, prefix, locale);
      const segments = normalizeSegments(typeof input === 'string' ? [{ type: 'text', data: { text: input } }] : input);
      if (requestsCommandHelp(segments)) return Object.freeze({ matched: true, status: 'executed', command: candidate.name, owner: candidate.slot.owner, value: help });
      return Object.freeze({ matched: true, status: 'invalid', command: candidate.name, owner: candidate.slot.owner,
        issues: Object.freeze([commandValidationIssue('invalidParameter', candidate.parameter?.name ?? 'arguments', locale)]), help });
    }
    if (!commandAdapterMatches(match.command, source)) return Object.freeze({ matched: false, status: 'unmatched' });
    const denial = await this.#permitDenial(match.command, source, operationSnapshot);
    if (denial !== undefined) return this.#denied(match.command, denial, locale);
    const definition = match.command.slot.definition;
    const authorSource = bindOperationInput(source, match.command.slot.owner, operationSnapshot);
    const help = commandHelp(commandDisplayName(match.command, locale), definition, prefix, locale);
    if (match.helpRequested) {
      const subcommands = await this.#subcommandLines(staticPrefix(match.command.segments), { prefix, source, snapshot: operationSnapshot, locale });
      const value = subcommands.length > 0 ? [help, '', commandMessages(locale, 'subcommandTitle'), ...subcommands].join('\n') : help;
      return Object.freeze({ matched: true, status: 'executed', command: match.command.name, owner: match.command.slot.owner, value });
    }
    const parsed = parseCommandArguments(definition, match.remaining, resolveDynamicParams(match.params, authorSource), resolveCommandSession(authorSource), locale);
    if (parsed.issues.length > 0) return Object.freeze({ matched: true, status: 'invalid', command: match.command.name,
      owner: match.command.slot.owner, issues: parsed.issues, help });
    // A source that carries its own operation (a framework Message) also brings that operation's
    // resources, read from the command author's view; an explicit factory from the caller is used as given.
    // Read before admission: whatever could fail here does so before the command's budget is spent.
    const operationFactory = request.operation
      ?? (sourceResources ? readOperationInputResources(authorSource, sourceResources) : undefined);
    const limit = admitCommandExecution(authorSource, match.command.slot.id, match.command.slot.owner, match.command.execution, operationSnapshot);
    if (limit) return Object.freeze({ matched: true, status: 'limited', command: match.command.name, owner: match.command.slot.owner, limit });
    const operation = operationFactory?.create({ owner: match.command.slot.owner, signal: operationFactory.signal });
    try {
      const value = await definition.execute(createCommandContext({
        snapshot: operationSnapshot, ownerId: match.command.slot.owner, input: authorSource,
        operation,
        interaction: interactionFactory?.(authorSource), adapter: definition.adapter,
        presentation: { locale, formatCommand: (localPath, owner = match.command.owner) => this.formatCommand(owner, localPath,
          source && typeof source === 'object' && 'conversation' in source ? commandPrefix : undefined, locale) },
      }, { args: textArgs(parsed.remaining), params: parsed.params, segments: parsed.remaining, options: parsed.options,
        ...(match.regex ? { match: match.regex } : {}) }));
      return Object.freeze({ matched: true, status: 'executed', command: match.command.name, owner: match.command.slot.owner, value });
    } catch (error) {
      // An expected, sender-caused refusal (UserFacingError) becomes this command's reply through the
      // normal outbound chain; every other failure keeps propagating to the inbound runtime's logs.
      const text = userFacingErrorText(error, locale);
      if (text === undefined) throw error;
      const refusalReason = userFacingRefusalReason((error as { reason?: unknown }).reason);
      return Object.freeze({ matched: true, status: 'executed', command: match.command.name, owner: match.command.slot.owner, value: text, refused: true,
        ...(refusalReason ? { refusalReason } : {}) });
    } finally {
      try { await operation?.resources?.close(); } catch { /* Cleanup never replaces the command's actual outcome. */ }
    }
  }

  /**
   * `<namespace>` / `<group> --help` (#1250): text that names a command group but no command lists
   * the commands under it the sender may run. Without `--help` only a configured `commandNamespace`
   * answers, so a chat word that happens to start a command path still reaches the Agent.
   */
  async #groupHelp(input: CommandMatchInput, context: GroupHelpContext): Promise<CommandDispatchResult | undefined> {
    const text = exactMessageText(input);
    if (text === undefined) return undefined;
    const tokens = splitCommand(text);
    const words = tokens.filter(token => token !== '--help' && token !== '-h');
    if (words.length === 0) return undefined;
    const helpFlag = words.length < tokens.length;
    if (words.length + 1 < tokens.length) return undefined;
    const isNamespace = this.#commands.some(record => record.namespace.length === words.length
      && record.namespace.every((word, index) => word === words[index]));
    if (!helpFlag && !isNamespace) return undefined;
    const lines = await this.#subcommandLines(words, context);
    if (lines.length === 0) return undefined;
    const group = words.join(' ');
    const owner = this.#commands.find(record => startsWithWords(record.segments, words))?.slot.owner ?? context.snapshot.root;
    return Object.freeze({ matched: true, status: 'executed', command: group, owner,
      value: [commandMessages(context.locale, 'groupTitle', { group: `${context.prefix}${group}` }), ...lines,
        '', commandMessages(context.locale, 'helpHint', { command: `${context.prefix}${group} <…>` })].join('\n') });
  }

  /**
   * Commands strictly under `words` that the sender may run, as menu lines. "Under" means at least
   * one more literal word: `fanyi <text>` is not a subcommand of `fanyi`, so a parameter command's
   * own `--help` does not list itself, and a bare `dungeon` does not list `dungeon [action]`.
   */
  async #subcommandLines(words: readonly string[], { prefix, source, snapshot, locale }: GroupHelpContext): Promise<readonly string[]> {
    const lines: string[] = [];
    for (const record of this.#commands) {
      if (staticSegmentCount(record.segments) <= words.length || !startsWithWords(record.segments, words)) continue;
      if (!(await this.#listable(record, source, snapshot))) continue;
      if (source === undefined && (record.permit?.length ?? 0) > 0) continue;
      const description = commandDescription(record.slot.definition, locale);
      lines.push(`  ${prefix}${commandDisplayName(record, locale)}${description ? `  - ${description}` : ''}`);
    }
    return lines;
  }

  /**
   * Issue #1250: this index was projected against a projection-time view of its generation, not the
   * committed snapshot a message's operation runs on. Without an explicit `snapshot`, a source that
   * carries an operation (a Message such as `context.input`) supplies that snapshot, so an index from
   * `context.project()` in a middleware or handler dispatches as that message's real author. The
   * operation's snapshot must hold this very index; one kept across a reload is refused.
   */
  #sourceSnapshot(source: unknown): RuntimeSnapshot | undefined {
    const bound = readOperationInputSnapshot(source);
    if (!bound) return undefined;
    if (bound !== this.snapshot && ![...bound.projections.values()].includes(this)) {
      throw new Error(`This CommandIndex (generation ${this.snapshot.generation}) is not the command projection of the message's generation `
        + `${bound.generation}: resolve it with context.project(commandFeatureId) inside the current middleware/handler `
        + 'instead of keeping it across a reload. See docs/authoring/commands.md#dispatch-from-middleware.');
    }
    return bound;
  }

  /** This index without the commands of owners disabled for `source`'s endpoint in `snapshot` (ADR 0050 §6). */
  #gatedForEndpoint(source: unknown, snapshot: RuntimeSnapshot): CommandIndex {
    let key: string | undefined;
    try { key = resolveFeatureTargetKey(snapshot, source as Parameters<typeof resolveFeatureTargetKey>[1]); } catch { return this; }
    const disabled = disabledFeatureOwners(snapshot, snapshot.tree.keys(), key);
    if (disabled.size === 0 || !this.#slots.some(slot => disabled.has(slot.owner))) return this;
    const cacheKey = [...disabled].sort().join('\0');
    let gated = this.#endpointGated.get(cacheKey);
    if (!gated) {
      gated = new CommandIndex(this.#slots.filter(slot => !disabled.has(slot.owner)), snapshot, this.#menu);
      this.#endpointGated.set(cacheKey, gated);
    }
    return gated;
  }

  #denied(record: CommandRecord, permit: string | null, locale: Locale): CommandDispatchResult {
    return Object.freeze({ matched: true, status: 'denied', command: record.name, owner: record.slot.owner,
      ...(permit ? { denial: Object.freeze({ permit, reason: describeDeniedPermit(permit, locale) }) } : {}) });
  }

  /** Diagnose only a reliable static route prefix; fully dynamic routes are ordinary chat candidates. */
  #invalidRoute(input: CommandMatchInput): CommandRecord | undefined {
    const segments = normalizeSegments(typeof input === 'string' ? [{ type: 'text', data: { text: input } }] : input);
    // segment-matcher clones its input before matching, so one copy serves every route.
    const matcherSegments = asMatcherSegments(segments);
    for (const route of this.#routes) {
      if (!route.record.parameter) continue;
      const result = route.literalMatcher?.match(matcherSegments);
      if (result && hasCommandBoundary(result.remaining)) return route.record;
    }
    return undefined;
  }

  /**
   * ADR 0056 §5: the shared evaluator (PermissionHost) over the three dimensions — sender zhin role,
   * sender platform standing and the Bot's own standing (resolved from the Adapter index cache).
   * `undefined` = allowed; a permit string = the first unmet one; `null` = denied without a reason
   * (no source or no Permission host).
   */
  async #permitDenial(record: CommandRecord, source: unknown, operationSnapshot: RuntimeSnapshot, cachedOnly = false): Promise<string | null | undefined> {
    const permits = record.permit;
    if (!permits || permits.length === 0) return undefined;
    if (!source || typeof source !== 'object') return null;
    const host = this.#resolveHost(operationSnapshot);
    if (!host) return null;
    const subject = toCommandPermissionSubject(source);
    if (!subject.sender?.id && !subject.scene?.id && !subject.adapter && !subject.endpoint) return null;
    const options = { source, ...(cachedOnly ? { cachedOnly } : {}) };
    if (await host.checkAll(permits, subject, options)) return undefined;
    // Denied: name the first unmet permit for the reply (same evaluator; Bot standing is cached now).
    let first: string | undefined;
    try { first = await host.firstDenied?.(permits, subject, options); } catch { return null; }
    if (first === undefined) return null;
    if (deniesSender(first)) return first;
    // zhinjs/zhin#1250: a scene or Bot condition failed first (`group()`, `bot:admin` …). When the
    // sender also fails a condition on themself (`trusted`, `platform:admin` …), that one is named
    // instead: the denial is then about the sender's permission, which a group answers silently.
    for (const permit of permits) {
      if (permit === first || !deniesSender(permit)) continue;
      try { if (!(await host.check(permit, subject))) return permit; } catch { return permit; }
    }
    return first;
  }

  /** Whether the menu should list `record` for `source` (adapter restriction + permits). */
  async #listable(record: CommandRecord, source: unknown, operationSnapshot: RuntimeSnapshot): Promise<boolean> {
    if (source === undefined) return true;
    if (!commandAdapterMatches(record, source)) return false;
    return (await this.#permitDenial(record, source, operationSnapshot)) === undefined;
  }

  #resolveHost(operationSnapshot: RuntimeSnapshot): PermissionHost | undefined {
    try {
      const resources = operationSnapshot.resources.get(operationSnapshot.root);
      if (!resources) return undefined;
      const host = resources.get(permissionHostToken.id);
      return host && typeof (host as PermissionHost).check === 'function'
        ? host as PermissionHost
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** `match` 正则：路由不中时，按指令列表顺序取第一条正文符合的指令（只看纯文本消息）。 */
  #matchPattern(input: CommandMatchInput): CommandMatch | undefined {
    const text = exactMessageText(input);
    if (text === undefined) return undefined;
    for (const command of this.#commands) {
      const regex = command.pattern?.exec(text);
      if (regex) return { command, params: Object.freeze({}), remaining: Object.freeze([]), helpRequested: false, regex };
    }
    return undefined;
  }

  #matchShortcut(input: CommandMatchInput): ShortcutEntry | undefined {
    const text = exactMessageText(input);
    if (text === undefined) return undefined;
    return this.#shortcuts.get(text);
  }

  #match(input: CommandMatchInput, exact: boolean): CommandMatch | undefined {
    const segments = normalizeSegments(
      typeof input === 'string'
        ? input.trim()
          ? [{ type: 'text', data: { text: input.trim() } }]
          : []
        : input,
    );
    if (segments.length === 0) return undefined;

    // segment-matcher clones its input before matching, so one copy serves every route.
    const matcherSegments = asMatcherSegments(segments);
    for (const route of this.#routes) {
      // Options may appear between the literal route and a directory-bound parameter.
      const literalResult = !exact ? route.literalMatcher?.match(matcherSegments) : undefined;
      const helpRequested = literalResult && hasCommandBoundary(literalResult.remaining)
        && requestsCommandHelp(normalizeSegments(literalResult.remaining));
      const parseDeclaredArguments = !exact && route.record.parameter && route.literalMatcher !== undefined
        && (Object.hasOwn(route.record.slot.definition.params ?? {}, route.record.parameter.name) || helpRequested);
      const result = parseDeclaredArguments ? literalResult : route.matcher.match(matcherSegments);
      if (!result || !hasCommandBoundary(result.remaining)) continue;
      const parameter = route.record.parameter;
      const params: Record<string, CommandDynamicValue> = { ...result.params };
      if (parameter?.rest && !parseDeclaredArguments) {
        const raw = result.params[parameter.name];
        const coerced = coerceRestValues(parameter, Array.isArray(raw) ? raw : []);
        if (!coerced || (isRequiredParameter(parameter) && coerced.length === 0)) continue;
        params[parameter.name] = coerced;
      }
      const remaining = normalizeSegments(result.remaining);
      if (exact && remaining.length > 0) continue;
      if (parameter && !parseDeclaredArguments && !parameter.rest && !isRequiredParameter(parameter)
        && (params[parameter.name] === '' || params[parameter.name] === null || params[parameter.name] === undefined)) {
        if (parameter.defaultValue !== undefined) params[parameter.name] = parameter.defaultValue;
        else delete params[parameter.name];
      }
      return {
        command: route.record,
        params: Object.freeze(params),
        remaining,
        helpRequested: literalResult ? !!helpRequested : requestsCommandHelp(remaining),
      };
    }
    return undefined;
  }

  #diagnoseParameter(name: string): void {
    const words = splitCommand(name);
    for (const route of this.#routes) {
      const parameter = route.record.parameter;
      if (!parameter || parameter.rest) continue;
      const parameterIndex = route.segments.findIndex((segment) => segment.startsWith('$'));
      if (words.length !== route.segments.length) continue;
      if (!route.segments.every((segment, index) =>
        index === parameterIndex || segment === words[index])) continue;
      const value = words[parameterIndex];
      if (value === undefined || matchesParameter(parameter.type, value)) continue;
      throw new CommandParameterValueError(parameter.name, parameter.type, value);
    }
  }

  // ==========================================================================
  // 内置菜单命令
  // ==========================================================================

  async #dispatchMenu(input: CommandMatchInput, context: CommandMenuContext): Promise<CommandMenuResult | undefined> {
    const { commandPrefix, keyword, locale } = context;
    const text = typeof input === 'string' ? input.trim() : exactMessageText(input);
    if (text === undefined) return undefined;
    const spaceIndex = text.search(/\s/u);
    const firstToken = spaceIndex === -1 ? text : text.slice(0, spaceIndex);
    const normalizedFirst = !commandPrefix && firstToken.startsWith('/')
      ? firstToken.slice(1)
      : firstToken;
    const matchedDefaultAlias = this.#menu?.keyword === undefined
      && DEFAULT_MENU_KEYWORDS.has(normalizedFirst.toLowerCase());
    if (text === keyword || (matchedDefaultAlias && spaceIndex === -1)) return this.#buildMenu({}, context);
    if (text.startsWith(keyword + ' ') || (matchedDefaultAlias && spaceIndex !== -1)) {
      const key = (text.startsWith(keyword + ' ')
        ? text.slice(keyword.length + 1)
        : text.slice(spaceIndex + 1)).trim();
      const args = key.split(/\s+/u);
      const flag = args.indexOf('--page');
      if (flag !== -1) {
        const pageText = args[flag + 1] ?? '';
        if (flag > 1 || args.length !== flag + 2 || !/^[1-9]\d*$/u.test(pageText)
          || !Number.isSafeInteger(Number(pageText))) {
          return { value: commandMessages(locale, 'invalidPage', { command: `${commandPrefix}${keyword}` }) };
        }
        return this.#buildMenu({ pluginKey: flag === 1 ? args[0] : undefined, page: Number(pageText) }, context);
      }
      if (key) return this.#buildMenu({ pluginKey: key }, context);
      return this.#buildMenu({}, context);
    }
    return undefined;
  }

  async #buildMenu({ pluginKey, page = 1 }: CommandMenuSelection, { commandPrefix, keyword, snapshot, locale, source }: CommandMenuContext): Promise<CommandMenuResult> {
    const root = snapshot.root;
    const targetId = pluginKey
      ? `${root}/${pluginKey.split('.').join('/')}` as PluginId
      : root;

    const node = snapshot.tree.get(targetId);
    if (!node) return { value: commandMessages(locale, 'missingPlugin', { plugin: pluginKey ?? '' }) };

    const listable = await Promise.all(this.#commands.map(async (cmd) => (await this.#listable(cmd, source, snapshot)) ? cmd : undefined));
    const available = listable.filter((cmd): cmd is CommandRecord => cmd !== undefined);
    const directCommands = available.filter((cmd) => cmd.slot.owner === targetId);
    // Navigable children: plugins whose subtree has a command this sender may run here. Adapters
    // (transports) and command-less service plugins are not menu entries.
    const adapters = new Set([...snapshot.capabilities.values()].filter(slot => String(slot.feature) === ADAPTER_FEATURE).map(slot => slot.owner));
    const withCommands = new Set<PluginId>();
    for (const cmd of available) {
      for (let id: PluginId | undefined = cmd.slot.owner; id && !withCommands.has(id); id = snapshot.tree.get(id)?.parent) withCommands.add(id);
    }
    const children = node.children
      .map((childId) => snapshot.tree.get(childId))
      .filter((child): child is NonNullable<typeof child> => !!child && withCommands.has(child.id) && !adapters.has(child.id));
    const effectiveCommands = targetId === root
      && directCommands.length === 0
      && available.length > 0
      && available.length <= MENU_PAGE_SIZE
      ? available
      : directCommands;

    const pages = Math.max(1, Math.ceil((effectiveCommands.length + children.length) / MENU_PAGE_SIZE));
    const invocation = `${commandPrefix}${keyword}${pluginKey ? ` ${pluginKey}` : ''}`;
    if (page > pages) return { value: commandMessages(locale, 'pageOutOfRange', { pages, command: invocation }) };
    const offset = (page - 1) * MENU_PAGE_SIZE;
    const pageCommands = effectiveCommands.slice(offset, offset + MENU_PAGE_SIZE);
    const pageChildren = children.slice(Math.max(0, offset - effectiveCommands.length), Math.max(0, offset + MENU_PAGE_SIZE - effectiveCommands.length));

    // The Root's internal instance key ("root") is not a name: use the project's display name, else a plain title.
    const rootName = targetId === root ? node.metadata?.displayName : undefined;
    const displayKey = pluginKey ?? (targetId === root ? rootName ?? commandMessages(locale, 'rootMenuName') : node.instanceKey);
    const lines: string[] = [targetId === root && !rootName
      ? commandMessages(locale, 'rootMenuTitle') : commandMessages(locale, 'menuTitle', { plugin: displayKey })];
    if (pages > 1) lines.push(commandMessages(locale, 'menuSummary', { page, pages, commands: effectiveCommands.length, plugins: children.length }));

    if (pageCommands.length > 0) {
      lines.push('');
      for (const cmd of pageCommands) {
        const description = commandDescription(cmd.slot.definition, locale);
        const desc = description ? `  - ${description}` : '';
        lines.push(`  ${commandPrefix}${commandDisplayName(cmd, locale)}${desc}`);
      }
    }

    if (pageChildren.length > 0) {
      lines.push('');
      lines.push(commandMessages(locale, 'childPlugins'));
      for (const child of pageChildren) {
        const childKey = pluginKey ? `${pluginKey}.${child.instanceKey}` : child.instanceKey;
        const label = child.metadata?.displayName ?? child.instanceKey;
        lines.push(`  ${childKey}  (${label})`);
      }
    }

    if (effectiveCommands.length === 0 && children.length === 0) {
      lines.push('');
      lines.push(commandMessages(locale, 'emptyMenu'));
    }

    const hints: string[] = [];
    if (children.length > 0) hints.push(commandMessages(locale, 'pluginHint', { command: `${commandPrefix}${keyword}` }));
    if (page > 1) hints.push(commandMessages(locale, 'previousPage', { command: `${invocation} --page ${page - 1}` }));
    if (page < pages) hints.push(commandMessages(locale, 'nextPage', { command: `${invocation} --page ${page + 1}` }));
    const hint = hints.length ? hints.join('\n') : undefined;
    if (hint) {
      lines.push('');
      lines.push(hint);
    }

    const text = lines.join('\n');
    const config = snapshot.config.get(root) as Record<string, unknown> | undefined;
    const menu: CommandMenuPage = Object.freeze({
      keyword, ...(pluginKey ? { pluginKey } : {}), page, pages, locale, title: displayKey,
      commands: Object.freeze(pageCommands.map(cmd => Object.freeze({
        name: `${commandPrefix}${commandDisplayName(cmd, locale)}`, description: commandDescription(cmd.slot.definition, locale),
      }))),
      plugins: Object.freeze(pageChildren.map(child => Object.freeze({
        name: pluginKey ? `${pluginKey}.${child.instanceKey}` : child.instanceKey,
        description: child.metadata?.displayName ?? child.instanceKey,
      }))),
      commandTotal: effectiveCommands.length, pluginTotal: children.length, hint, text,
      appearance: Object.freeze(readMenuAppearance(config?.menuStyle)),
    });
    if (!snapshot.resources.get(root)?.has(htmlRendererToken.id)) return { value: text, menu };
    return { menu, value: renderCommandMenu(displayKey, menu.commands, menu.plugins, hint, text, {
      page, pages, locale, commandTotal: menu.commandTotal, pluginTotal: menu.pluginTotal, appearance: menu.appearance,
    }) };
  }
}

interface GroupHelpContext {
  readonly prefix: string;
  readonly source: unknown;
  readonly snapshot: RuntimeSnapshot;
  readonly locale: Locale;
}

function startsWithWords(segments: readonly string[], words: readonly string[]): boolean {
  return words.every((word, index) => segments[index] === word);
}

/** The literal words before a route's parameter segment. */
function staticPrefix(segments: readonly string[]): readonly string[] {
  const at = segments.findIndex(segment => segment.startsWith('$'));
  return at === -1 ? segments : segments.slice(0, at);
}

function commandDisplaySegments(record: CommandRecord, locale: Locale): readonly string[] {
  return record.preferredSegments[locale] ?? record.segments;
}

function commandDisplayName(record: CommandRecord, locale: Locale): string {
  return displayName(commandDisplaySegments(record, locale), record.parameter);
}

/**
 * The near-miss form of a command: a parameter that declares `suggestions` shows them
 * (`玩石头剪刀布 开始|继续|退出`) instead of `[action]`, which reads like "what to play". #1250
 */
function commandSuggestionName(record: CommandRecord, locale: Locale): string {
  const parameter = record.parameter;
  const schema = parameter ? record.slot.definition.params?.[parameter.name] : undefined;
  const values = schema?.suggestionsI18n?.[locale] ?? schema?.suggestions;
  if (!parameter || !values?.length) return commandDisplayName(record, locale);
  return commandDisplaySegments(record, locale)
    .map(segment => segment === `$${parameter.name}` ? values.join('|') : segment).join(' ');
}

/** The message's resolved language, else the same project language messages use ({@link projectLocale}). */
function commandLocale(source: unknown, snapshot: RuntimeSnapshot): Locale {
  const locale = source && typeof source === 'object' && 'locale' in source ? source.locale : undefined;
  return isLocale(locale) ? locale : projectLocale(snapshot);
}

export function isCommandIndex(value: unknown): value is CommandIndex {
  return !!value && typeof value === 'object'
    && (value as { readonly $projection?: unknown }).$projection === 'zhin.command-index/1';
}

/**
 * Order in which command slots claim routes: plugins in tree order (depth first from the Root,
 * children as declared), then by plugin-local path. Independent of the capability map's insertion
 * order, so a hot reload that re-inserts one plugin's slots never changes who keeps a route.
 */
function registrationOrder<T extends Readonly<CapabilitySlot<CommandDefinition>>>(
  slots: readonly T[],
  rank: ReadonlyMap<PluginId, number>,
): readonly T[] {
  const order = (owner: PluginId) => rank.get(owner) ?? Number.MAX_SAFE_INTEGER;
  const text = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
  return [...slots].sort((left, right) => order(left.owner) - order(right.owner)
    || text(String(left.owner), String(right.owner))
    || text(left.localName, right.localName)
    || text(String(left.id), String(right.id)));
}

/** Plugin tree order: depth first from the Root, children as declared. */
function pluginRanks(snapshot: RuntimeSnapshot): ReadonlyMap<PluginId, number> {
  const rank = new Map<PluginId, number>();
  const visit = (id: PluginId): void => {
    if (rank.has(id)) return;
    rank.set(id, rank.size);
    for (const child of snapshot.tree.get(id)?.children ?? []) visit(child);
  };
  visit(snapshot.root);
  for (const id of snapshot.tree.keys()) visit(id);
  return rank;
}

/** Throws when two routes of one plugin overlap (`claims` in registration order). */
function assertNoSamePluginOverlap(
  claims: readonly { readonly keys: readonly string[]; readonly claimant: CommandRouteClaimant }[],
): void {
  const byOwner = new Map<PluginId, { readonly key: string; readonly claimant: CommandRouteClaimant }[]>();
  for (const { keys, claimant } of claims) {
    let taken = byOwner.get(claimant.owner);
    if (!taken) {
      taken = [];
      byOwner.set(claimant.owner, taken);
    }
    for (const key of keys) {
      for (const existing of taken) {
        if (routeShapesOverlap(key, existing.key)) {
          throw new Error(`Duplicate Command route "${key}" (${claimantLabel(claimant)} vs ${claimantLabel(existing.claimant)})`);
        }
      }
    }
    // A command's own route shapes (one per accepted arity) overlap each other by design.
    taken.push(...keys.map((key) => ({ key, claimant })));
  }
}

/** How the build-time error names a route's registration (unchanged wording). */
function claimantLabel(claimant: CommandRouteClaimant): string {
  return claimant.kind === 'command' ? claimant.source : `${claimant.source} ${claimant.kind} ${JSON.stringify(claimant.entry)}`;
}

function commandClaimant(
  snapshot: RuntimeSnapshot,
  slot: Readonly<CapabilitySlot<CommandDefinition>>,
  command: string,
  kind: CommandRouteClaimant['kind'],
  entry?: string,
): CommandRouteClaimant {
  const node = snapshot.tree.get(slot.owner);
  return Object.freeze({
    owner: slot.owner,
    plugin: node?.instanceKey || String(slot.owner),
    ...(node?.packageName ? { packageName: node.packageName } : {}),
    ...(slot.owner === snapshot.root ? { root: true as const } : {}),
    capability: slot.id,
    command,
    localPath: runtimeSegments(slot.localName).filter((segment) => !segment.startsWith('$')).join(' '),
    source: slot.source,
    kind,
    ...(entry !== undefined ? { entry } : {}),
  });
}

/**
 * 用户路由来自命令的本地能力路径；只有插件配置显式声明 commandNamespace
 * 时才在其前面增加命名空间。owner 始终只属于 CapabilityId。
 */
function runtimeSegments(localName: string): string[] {
  return localName.split('/');
}

function commandNamespace(snapshot: RuntimeSnapshot, owner: PluginId): readonly string[] {
  const config = snapshot.config.get(owner) as Readonly<Record<string, unknown>> | undefined;
  const value = config?.commandNamespace;
  if (value === undefined || value === '') return Object.freeze([]);
  if (typeof value !== 'string') {
    throw new TypeError(`Invalid commandNamespace for ${owner}: expected a string`);
  }
  const segments = splitCommand(value);
  if (segments.length === 0 || segments.some((segment) => !isCommandNamespaceSegment(segment))) {
    throw new TypeError(
      `Invalid commandNamespace for ${owner}: expected space-separated command segments`,
    );
  }
  return Object.freeze([...segments]);
}

/**
 * 插件实例配置 disabledCommands 列出的指令不进入路由表。条目写插件本地的静态路径
 * （不含 commandNamespace 与参数段，如 `fanyi`、`netease login`）；写上级路径会连同
 * 其子命令一起禁用。未匹配任何指令的条目被忽略。
 */
function disabledCommands(snapshot: RuntimeSnapshot, owner: PluginId): readonly string[] {
  const config = snapshot.config.get(owner) as Readonly<Record<string, unknown>> | undefined;
  const value = config?.disabledCommands;
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`Invalid disabledCommands for ${owner}: expected an array of command names`);
  }
  return Object.freeze(value.map((entry: string) => splitCommand(entry).join(' ')).filter(Boolean));
}

function isDisabledCommand(localName: string, disabled: readonly string[]): boolean {
  if (disabled.length === 0) return false;
  const path = runtimeSegments(localName).filter((segment) => !segment.startsWith('$')).join(' ');
  return disabled.some((entry) => path === entry || path.startsWith(`${entry} `));
}

function isCommandNamespaceSegment(value: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(value);
}

/**
 * 用 alias 词序列替换全部本地静态段；动态段保留。
 */
function aliasRuntimeSegments(
  alias: string,
  primarySegments: readonly string[],
): string[] {
  const aliasTokens = alias.trim().split(/\s+/u).filter(Boolean);
  const dynamicTail = primarySegments.filter((segment) => segment.startsWith('$'));
  return [...aliasTokens, ...dynamicTail];
}

function occupancyKey(
  segments: readonly string[],
  parameter: CommandParameterDefinition | undefined,
): string {
  return parameter ? routeShape(segments) : segments.join(' ');
}

/** Accepted token arities, including optional tails and an unbounded rest tail. */
function declaredRouteShapes(segments: readonly string[], definition: CommandDefinition): readonly string[] {
  let variants: string[][] = [[]];
  const append = (token: string, optional = false): void => {
    const withToken = variants.map((variant) => [...variant, token]);
    variants = [...new Map((optional ? [...variants, ...withToken] : withToken)
      .map((variant) => [variant.join(' '), variant])).values()];
  };
  for (const segment of segments) {
    if (!segment.startsWith('$')) { append(segment); continue; }
    const parameter = definition.$parameter;
    if (!parameter) continue;
    if (parameter.rest) append(isRequiredParameter(parameter) ? '$+' : '$*');
    else append('$', !isRequiredParameter(parameter));
  }
  for (const [name, schema] of Object.entries(definition.params ?? {})) {
    if (name === definition.$parameter?.name) continue;
    const optional = schema.optional === true || schema.default !== undefined;
    if (schema.rest) append(optional ? '$*' : '$+');
    else append('$', optional);
  }
  return [...new Set(variants.map((variant) => variant.join(' ')))];
}

function routeShapesOverlap(left: string, right: string): boolean {
  const shape = (key: string) => {
    const tokens = key.split(' ');
    const repeat = tokens.at(-1);
    const rest = repeat === '$*' || repeat === '$+';
    const prefix = rest ? tokens.slice(0, -1) : tokens;
    return { prefix, min: prefix.length + (repeat === '$+' ? 1 : 0), max: rest ? Infinity : prefix.length };
  };
  const a = shape(left);
  const b = shape(right);
  const length = Math.max(a.min, b.min);
  if (length > Math.min(a.max, b.max)) return false;
  for (let index = 0; index < length; index++) {
    if ((a.prefix[index] ?? '$') !== (b.prefix[index] ?? '$')) return false;
  }
  return true;
}

function normalizeAliasList(
  alias: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!alias || alias.length === 0) return undefined;
  return Object.freeze(alias.map((entry) => entry.trim().split(/\s+/u).filter(Boolean).join(' ')));
}

function resolveShortcutParams(
  definition: CommandDefinition,
  prefill: Readonly<Record<string, CommandDynamicValue>>,
  source: string,
): Record<string, CommandDynamicValue> {
  for (const [name, schema] of Object.entries(definition.options ?? {})) {
    if (schema.optional === false && schema.default === undefined) {
      throw new TypeError(`Invalid shortcut for ${source}: cannot supply required option --${name}`);
    }
  }
  const allowed = new Set<string>();
  const parameter = definition.$parameter;
  if (parameter) allowed.add(parameter.name);
  if (definition.params) {
    for (const key of Object.keys(definition.params)) allowed.add(key);
  }

  for (const key of Object.keys(prefill)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `Invalid shortcut params for ${source}: unknown key ${JSON.stringify(key)}`,
      );
    }
  }

  const result: Record<string, CommandDynamicValue> = { ...prefill };

  if (parameter) {
    if (result[parameter.name] === undefined) {
      if (parameter.defaultValue !== undefined) {
        result[parameter.name] = parameter.defaultValue;
      } else if (isRequiredParameter(parameter)) {
        throw new TypeError(
          `Invalid shortcut params for ${source}: missing required ${parameter.name}`,
        );
      }
    }
  } else if (allowed.size === 0 && Object.keys(prefill).length > 0) {
    throw new TypeError(
      `Invalid shortcut params for ${source}: command has no params declaration`,
    );
  }

  if (definition.params) {
    for (const [name, schema] of Object.entries(definition.params)) {
      if (result[name] === undefined && schema.default !== undefined) {
        result[name] = schema.default;
      }
    }
  }

  return result;
}

function exactMessageText(input: CommandMatchInput): string | undefined {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed || undefined;
  }
  // 仅纯单 text 段可作整句 shortcut；含 mention/image 等则不走 shortcut。
  if (input.length !== 1) return undefined;
  const only = input[0];
  if (!only || only.type !== 'text' || typeof only.data.text !== 'string') return undefined;
  const trimmed = only.data.text.trim();
  return trimmed || undefined;
}

/**
 * Route-shape rule for a convention command: at most one dynamic segment, and it is the final one.
 * Shared by the runtime index and {@link bindCommandSource}.
 */
export function assertParameterSegment(
  segments: readonly string[],
  parameter: CommandParameterDefinition | undefined,
  source: string,
): void {
  const dynamicSegments = segments.filter((segment) => segment.startsWith('$'));
  if (!parameter && dynamicSegments.length === 0) return;
  if (parameter && dynamicSegments.length === 1
    && dynamicSegments[0] === `$${parameter.name}`
    && segments.at(-1) === dynamicSegments[0]) return;
  const dynamic = dynamicSegments[0] ?? (parameter ? `$${parameter.name}` : '$?');
  throw new Error(
    `Invalid Command path for ${source}: the dynamic segment "${dynamic}" must be the only dynamic `
    + `segment and be the final path segment. `
    + (parameter
      ? `Hint: keep only one dynamic entry, e.g. "commands/add/[${parameter.name}]/index.ts".`
      : 'Hint: keep only one dynamic entry at the end of the command path.'),
  );
}

function isRequiredParameter(parameter: CommandParameterDefinition): boolean {
  return parameter.optional === true ? false : parameter.defaultValue === undefined;
}

function displayName(
  segments: readonly string[],
  parameter: CommandParameterDefinition | undefined,
): string {
  return segments.map((segment) => {
    if (!segment.startsWith('$')) return segment;
    const label = segment.slice(1);
    const required = !parameter || isRequiredParameter(parameter);
    if (parameter?.rest) return required ? `<...${label}>` : `[...${label}]`;
    return required ? `<${label}>` : `[${label}]`;
  }).join(' ');
}

function compileLiteralMatcher(segments: readonly string[], parameter: CommandParameterDefinition | undefined): SegmentMatcher | undefined {
  if (!parameter) return undefined;
  const literals = segments.filter((segment) => !segment.startsWith('$'));
  return literals.length > 0 ? new SegmentMatcher(literals.join(' '), segmentFields) : undefined;
}

function matcherPattern(
  segments: readonly string[],
  parameter: CommandParameterDefinition | undefined,
): string {
  return segments.map((segment) => {
    if (!segment.startsWith('$')) return segment;
    if (!parameter) throw new Error(`Missing Command parameter metadata: ${segment}`);
    const type = matcherType(parameter.type);
    if (parameter.rest) {
      return `[...${parameter.name}:${isStructuredRestType(parameter.type) ? type : 'text'}]`;
    }
    if (isRequiredParameter(parameter)) return `<${parameter.name}:${type}>`;
    return `[${parameter.name}:${type}]`;
  }).join(' ');
}

function matcherType(type: CommandParameterType): string {
  return type === 'string' ? 'word' : type;
}

function isStructuredRestType(type: CommandParameterType): boolean {
  return type === 'mention'
    || type === 'image'
    || type === 'face'
    || type === 'reply'
    || type === 'forward'
    || type === 'dice'
    || type === 'rps';
}

function coerceRestValues(
  parameter: CommandParameterDefinition,
  values: readonly unknown[],
): readonly (string | number | boolean)[] | undefined {
  const type = parameter.type;
  if (type === 'text' || isStructuredRestType(type)) {
    return values as readonly (string | number | boolean)[];
  }
  const words = values.flatMap((value) =>
    typeof value === 'string' ? value.split(/\s+/u).filter(Boolean) : []);
  if (type === 'string' || type === 'word') return words;
  if (type === 'number' || type === 'integer' || type === 'float') {
    const numbers: number[] = [];
    for (const [index, word] of words.entries()) {
      const number = Number(word);
      if (!Number.isFinite(number)
        || (type === 'integer' && !Number.isInteger(number))
        || (type === 'float' && !word.includes('.'))) return undefined;
      numbers[index] = number;
    }
    return numbers;
  }
  if (type === 'boolean') {
    if (!words.every((word) => word === 'true' || word === 'false')) return undefined;
    return words.map((word) => word === 'true');
  }
  return undefined;
}

function routeShape(segments: readonly string[]): string {
  return segments.map((segment) => segment.startsWith('$') ? '$' : segment).join(' ');
}

function compareRecords(left: CommandRecord, right: CommandRecord): number {
  return left.name.localeCompare(right.name);
}

/**
 * Route precedence: the longer literal path first (#1250 command-namespace-param-commands-swallowed:
 * `60s fanyi <text>` must beat a bare `60s` command that would otherwise take `fanyi 你好` as
 * ignored trailing words), then a static route before a dynamic one of the same literal length.
 */
function compareRoutes(left: CommandRoute, right: CommandRoute): number {
  return staticSegmentCount(right.segments) - staticSegmentCount(left.segments)
    || dynamicWeight(left) - dynamicWeight(right)
    || right.segments.length - left.segments.length
    || right.record.name.length - left.record.name.length
    || left.record.name.localeCompare(right.record.name);
}

function dynamicWeight(route: CommandRoute): number {
  if (!route.record.parameter) return 0;
  return route.record.parameter.rest ? 2 : 1;
}

function staticSegmentCount(segments: readonly string[]): number {
  return segments.filter((segment) => !segment.startsWith('$')).length;
}

function splitCommand(value: string): readonly string[] {
  const normalized = value.trim();
  return normalized ? normalized.split(/\s+/) : [];
}

function matchesParameter(type: CommandParameterType, value: string): boolean {
  const matcher = TypeMatcherRegistry.getMatcher(matcherType(type));
  return matcher ? matcher.match(value).success : false;
}

function asMatcherSegments(
  segments: readonly Readonly<CommandSegment>[],
): MessageSegment[] {
  return segments.map((segment) => ({
    type: typeof segment.type === 'string' ? segment.type : { name: segment.type.name },
    data: { ...segment.data },
  }));
}

function hasCommandBoundary(segments: readonly MessageSegment[]): boolean {
  const first = segments[0];
  if (!first || first.type !== 'text') return true;
  const text = first.data.text;
  return typeof text !== 'string' || text.length === 0 || /^\s/u.test(text);
}

function normalizeSegments(
  input: readonly Readonly<CommandSegment>[],
): readonly Readonly<CommandSegment>[] {
  const segments = input.map((segment) => ({
    type: typeof segment.type === 'string' ? segment.type : { name: segment.type.name },
    data: { ...segment.data },
  }));
  trimBoundary(segments, 'start');
  trimBoundary(segments, 'end');
  return Object.freeze(segments.map((segment) => Object.freeze({
    type: typeof segment.type === 'string'
      ? segment.type
      : Object.freeze({ name: segment.type.name }),
    data: Object.freeze(segment.data),
  })));
}

function trimBoundary(
  segments: Array<{ type: string | { name: string }; data: Record<string, unknown> }>,
  side: 'start' | 'end',
): void {
  while (segments.length > 0) {
    const index = side === 'start' ? 0 : segments.length - 1;
    const segment = segments[index];
    if (!segment || segment.type !== 'text' || typeof segment.data.text !== 'string') return;
    const text = side === 'start' ? segment.data.text.trimStart() : segment.data.text.trimEnd();
    if (text) {
      segment.data.text = text;
      return;
    }
    segments.splice(index, 1);
  }
}

function textArgs(segments: readonly Readonly<CommandSegment>[]): readonly string[] {
  return Object.freeze(segments.flatMap((segment) => {
    if (segment.type !== 'text' || typeof segment.data.text !== 'string') return [];
    return splitCommand(segment.data.text);
  }));
}

/** A routed command whose `match` also fits the text exposes the match result too. */
function withPattern(match: CommandMatch, input: CommandMatchInput): CommandMatch {
  const pattern = match.command.pattern;
  const text = pattern ? exactMessageText(input) : undefined;
  const regex = pattern && text !== undefined ? pattern.exec(text) : null;
  return regex ? { ...match, regex } : match;
}

function toDescriptor({
  slot: _slot,
  segments: _segments,
  namespace: _namespace,
  parameter: _parameter,
  pattern: _pattern,
  ...descriptor
}: CommandRecord): CommandDescriptor {
  return descriptor;
}

export class CommandParameterValueError extends TypeError {
  constructor(name: string, type: CommandParameterType, value: string) {
    super(`Invalid value for Command parameter ${name}:${type}: ${value}`);
    this.name = 'CommandParameterValueError';
  }
}

export class CommandArgumentValidationError extends TypeError {
  constructor(readonly issues: readonly CommandValidationIssue[], readonly help: string) {
    super(issues.map((issue) => issue.message).join('\n') + '\n' + help);
    this.name = 'CommandArgumentValidationError';
  }
}
