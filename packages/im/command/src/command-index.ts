import {
  SegmentMatcher,
  TypeMatcherRegistry,
  type MessageSegment,
} from 'segment-matcher';
import {
  htmlRendererToken,
  resolveLocale,
  type CapabilityId,
  type CapabilitySlot,
  type PluginId,
  type RuntimeSnapshot,
  type Locale,
} from '@zhin.js/plugin-runtime';
import type { UserInteractionFactory } from '@zhin.js/interaction';
import { bindOperationInput } from '@zhin.js/feature-kit';
import {
  permissionHostToken,
  type PermissionHost,
} from '@zhin.js/permission';
import { commandAdapterMatches, toCommandPermissionSubject } from './permission-explanation.js';
import { commandUsage, commandHelp, parseCommandArguments, requestsCommandHelp, commandValidationIssue, type CommandValidationIssue } from './arguments.js';
import { commandDescription, commandMessages } from './messages.js';
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
}

/** One dispatch reads the caller's exact operation generation and presentation. */
export interface CommandDispatchRequest {
  readonly input: CommandMatchInput;
  readonly source?: unknown;
  readonly interactionFactory?: UserInteractionFactory;
  readonly commandPrefix?: string;
  readonly snapshot?: RuntimeSnapshot;
  readonly locale?: Locale;
}
/** Presentation and generation shared across one menu lookup/render operation. */
interface CommandMenuContext {
  readonly commandPrefix: string;
  readonly keyword: string;
  readonly snapshot: RuntimeSnapshot;
  readonly locale: Locale;
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
  readonly preferredSegments: Readonly<Partial<Record<Locale, readonly string[]>>>;
  readonly parameter?: CommandParameterDefinition;
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

export class CommandIndex {
  readonly $projection = 'zhin.command-index/1' as const;
  readonly #commands: readonly CommandRecord[];
  readonly #routes: readonly CommandRoute[];
  readonly #shortcuts: ReadonlyMap<string, ShortcutEntry>;
  readonly #menu?: CommandMenuConfig;

  constructor(
    slots: readonly Readonly<CapabilitySlot<CommandDefinition>>[],
    private readonly snapshot: RuntimeSnapshot,
    menu?: CommandMenuConfig,
  ) {
    this.#menu = menu;
    const commands: CommandRecord[] = [];
    const routes: CommandRoute[] = [];
    const occupancy = new Map<string, string>();
    const shortcuts = new Map<string, ShortcutEntry>();

    const claim = (keys: readonly string[], source: string): void => {
      for (const key of keys) {
        for (const [occupied, existing] of occupancy) {
          if (routeShapesOverlap(key, occupied)) {
            throw new Error(`Duplicate Command route "${key}" (${source} vs ${existing})`);
          }
        }
      }
      for (const key of keys) occupancy.set(key, source);
    };

    const disabledByOwner = new Map<PluginId, readonly string[]>();
    for (const slot of slots) {
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
      const alias = normalizeAliasList(slot.definition.alias);
      const permit = slot.definition.permit
        ? Object.freeze([...slot.definition.permit])
        : undefined;
      const shortcutKeys = slot.definition.shortcut
        ? Object.freeze(Object.keys(slot.definition.shortcut).map((key) => key.trim()))
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
        slot,
        segments: Object.freeze(primarySegments),
        preferredSegments: Object.freeze(Object.fromEntries(Object.entries(slot.definition.preferredAliasI18n ?? {}).map(([locale, entry]) =>
          [locale, Object.freeze([...namespace, ...aliasRuntimeSegments(entry, primarySegments.slice(namespace.length))])]))),
        parameter,
      });

      claim([...new Set([occupancyKey(primarySegments, parameter), ...declaredRouteShapes(primarySegments, slot.definition)])], slot.source);
      routes.push({
        record,
        segments: primarySegments,
        matcher: new SegmentMatcher(matcherPattern(primarySegments, parameter), segmentFields),
        literalMatcher: compileLiteralMatcher(primarySegments, parameter),
        kind: 'primary',
      });

      if (alias) {
        for (const entry of alias) {
          const aliasSegments = [...namespace, ...aliasRuntimeSegments(
            entry,
            primarySegments.slice(namespace.length),
          )];
          assertParameterSegment(aliasSegments, parameter, `${slot.source} alias ${JSON.stringify(entry)}`);
          claim([...new Set([occupancyKey(aliasSegments, parameter), ...declaredRouteShapes(aliasSegments, slot.definition)])], `${slot.source} alias ${JSON.stringify(entry)}`);
          routes.push({
            record,
            segments: Object.freeze(aliasSegments),
            matcher: new SegmentMatcher(matcherPattern(aliasSegments, parameter), segmentFields),
            literalMatcher: compileLiteralMatcher(aliasSegments, parameter),
            kind: 'alias',
          });
        }
      }

      if (slot.definition.shortcut) {
        for (const [rawTrigger, prefill] of Object.entries(slot.definition.shortcut)) {
          const trigger = [...namespace, ...splitCommand(rawTrigger)].join(' ');
          claim([trigger], `${slot.source} shortcut ${JSON.stringify(trigger)}`);
          shortcuts.set(trigger, {
            record,
            params: Object.freeze(resolveShortcutParams(
              slot.definition,
              prefill,
              `${slot.source} shortcut ${JSON.stringify(trigger)}`,
            )),
          });
        }
      }

      commands.push(record);
    }

    this.#commands = Object.freeze(commands.sort(compareRecords));
    this.#routes = Object.freeze(routes.sort(compareRoutes));
    this.#shortcuts = shortcuts;
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

  async execute(name: string, args: readonly string[] = [], operationSnapshot: RuntimeSnapshot = this.snapshot): Promise<unknown> {
    const locale = commandLocale(undefined, operationSnapshot);
    const match = this.#match(name, false);
    if (!match) {
      this.#diagnoseParameter(name);
      throw new Error(`Unknown Command: ${name}`);
    }
    if (!(await this.#permitAllows(match.command, undefined, operationSnapshot))) throw new Error(`Permission denied for Command: ${match.command.name}`);
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

  async dispatch({ input, source, interactionFactory, commandPrefix, snapshot: operationSnapshot = this.snapshot,
    locale: localeOverride }: CommandDispatchRequest): Promise<CommandDispatchResult> {
    const locale = localeOverride ?? commandLocale(source, operationSnapshot);
    const prefix = commandPrefix ?? '';
    if (this.#menu) {
      const keyword = this.#menu.keyword ?? commandMessages(locale, 'menuKeyword');
      const menuResult = this.#dispatchMenu(input, { commandPrefix: prefix, snapshot: operationSnapshot, locale, keyword });
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
    const match = shortcut
      ? { command: shortcut.record, params: shortcut.params, remaining: Object.freeze([]), helpRequested: false }
      : this.#match(input, false);
    if (!match) {
      const candidate = this.#invalidRoute(input);
      if (!candidate) return Object.freeze({ matched: false, status: 'unmatched' });
      if (!commandAdapterMatches(candidate, source)) return Object.freeze({ matched: false, status: 'unmatched' });
      if (!(await this.#permitAllows(candidate, source, operationSnapshot))) return this.#denied(candidate);
      const help = commandHelp(commandDisplayName(candidate, locale), candidate.slot.definition, prefix, locale);
      const segments = normalizeSegments(typeof input === 'string' ? [{ type: 'text', data: { text: input } }] : input);
      if (requestsCommandHelp(segments)) return Object.freeze({ matched: true, status: 'executed', command: candidate.name, owner: candidate.slot.owner, value: help });
      return Object.freeze({ matched: true, status: 'invalid', command: candidate.name, owner: candidate.slot.owner,
        issues: Object.freeze([commandValidationIssue('invalidParameter', candidate.parameter?.name ?? 'arguments', locale)]), help });
    }
    if (!commandAdapterMatches(match.command, source)) return Object.freeze({ matched: false, status: 'unmatched' });
    if (!(await this.#permitAllows(match.command, source, operationSnapshot))) return this.#denied(match.command);
    const definition = match.command.slot.definition;
    const authorSource = bindOperationInput(source, match.command.slot.owner, operationSnapshot);
    const help = commandHelp(commandDisplayName(match.command, locale), definition, prefix, locale);
    if (match.helpRequested) {
      return Object.freeze({ matched: true, status: 'executed', command: match.command.name, owner: match.command.slot.owner, value: help });
    }
    const parsed = parseCommandArguments(definition, match.remaining, resolveDynamicParams(match.params, authorSource), resolveCommandSession(authorSource), locale);
    if (parsed.issues.length > 0) return Object.freeze({ matched: true, status: 'invalid', command: match.command.name,
      owner: match.command.slot.owner, issues: parsed.issues, help });
    const limit = admitCommandExecution(authorSource, match.command.slot.id, match.command.slot.owner, match.command.execution, operationSnapshot);
    if (limit) return Object.freeze({ matched: true, status: 'limited', command: match.command.name, owner: match.command.slot.owner, limit });
    const value = await definition.execute(createCommandContext({
      snapshot: operationSnapshot, ownerId: match.command.slot.owner, input: authorSource,
      interaction: interactionFactory?.(authorSource), adapter: definition.adapter,
      presentation: { locale, formatCommand: (localPath, owner = match.command.owner) => this.formatCommand(owner, localPath,
        source && typeof source === 'object' && 'conversation' in source ? commandPrefix : undefined, locale) },
    }, { args: textArgs(parsed.remaining), params: parsed.params, segments: parsed.remaining, options: parsed.options }));
    return Object.freeze({ matched: true, status: 'executed', command: match.command.name, owner: match.command.slot.owner, value });
  }

  #denied(record: CommandRecord): CommandDispatchResult {
    return Object.freeze({ matched: true, status: 'denied', command: record.name, owner: record.slot.owner });
  }

  /** Diagnose only a reliable static route prefix; fully dynamic routes are ordinary chat candidates. */
  #invalidRoute(input: CommandMatchInput): CommandRecord | undefined {
    const segments = normalizeSegments(typeof input === 'string' ? [{ type: 'text', data: { text: input } }] : input);
    for (const route of this.#routes) {
      if (!route.record.parameter) continue;
      const result = route.literalMatcher?.match(asMatcherSegments(segments));
      if (result && hasCommandBoundary(result.remaining)) return route.record;
    }
    return undefined;
  }

  async #permitAllows(record: CommandRecord, source: unknown, operationSnapshot: RuntimeSnapshot): Promise<boolean> {
    const permits = record.permit;
    if (!permits || permits.length === 0) return true;
    if (!source || typeof source !== 'object') return false;
    const host = this.#resolveHost(operationSnapshot);
    if (!host) return false;
    const subject = toCommandPermissionSubject(source);
    if (!subject.sender?.id && !subject.scene?.id && !subject.adapter && !subject.endpoint) return false;
    return host.checkAll(permits, subject);
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

    for (const route of this.#routes) {
      // Options may appear between the literal route and a directory-bound parameter.
      const literalResult = !exact ? route.literalMatcher?.match(asMatcherSegments(segments)) : undefined;
      const helpRequested = literalResult && hasCommandBoundary(literalResult.remaining)
        && requestsCommandHelp(normalizeSegments(literalResult.remaining));
      const parseDeclaredArguments = !exact && route.record.parameter && route.literalMatcher !== undefined
        && (Object.hasOwn(route.record.slot.definition.params ?? {}, route.record.parameter.name) || helpRequested);
      const result = parseDeclaredArguments ? literalResult : route.matcher.match(asMatcherSegments(segments));
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

  #dispatchMenu(input: CommandMatchInput, context: CommandMenuContext): CommandMenuResult | undefined {
    const { commandPrefix, keyword, locale } = context;
    const text = typeof input === 'string' ? input.trim() : exactMessageText(input);
    if (text === undefined) return undefined;
    if (text === keyword) return this.#buildMenu({}, context);
    if (text.startsWith(keyword + ' ')) {
      const key = text.slice(keyword.length + 1).trim();
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

  #buildMenu({ pluginKey, page = 1 }: CommandMenuSelection, { commandPrefix, keyword, snapshot, locale }: CommandMenuContext): CommandMenuResult {
    const root = snapshot.root;
    const targetId = pluginKey
      ? `${root}/${pluginKey.split('.').join('/')}` as PluginId
      : root;

    const node = snapshot.tree.get(targetId);
    if (!node) return { value: commandMessages(locale, 'missingPlugin', { plugin: pluginKey ?? '' }) };

    const directCommands = this.#commands.filter((cmd) => cmd.slot.owner === targetId);
    const children = node.children
      .map((childId) => snapshot.tree.get(childId))
      .filter((child): child is NonNullable<typeof child> => !!child);

    const pages = Math.max(1, Math.ceil((directCommands.length + children.length) / MENU_PAGE_SIZE));
    const invocation = `${commandPrefix}${keyword}${pluginKey ? ` ${pluginKey}` : ''}`;
    if (page > pages) return { value: commandMessages(locale, 'pageOutOfRange', { pages, command: invocation }) };
    const offset = (page - 1) * MENU_PAGE_SIZE;
    const pageCommands = directCommands.slice(offset, offset + MENU_PAGE_SIZE);
    const pageChildren = children.slice(Math.max(0, offset - directCommands.length), Math.max(0, offset + MENU_PAGE_SIZE - directCommands.length));

    const displayKey = pluginKey ?? node.instanceKey;
    const lines: string[] = [commandMessages(locale, 'menuTitle', { plugin: displayKey })];
    if (pages > 1) lines.push(commandMessages(locale, 'menuSummary', { page, pages, commands: directCommands.length, plugins: children.length }));

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

    if (directCommands.length === 0 && children.length === 0) {
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
      commandTotal: directCommands.length, pluginTotal: children.length, hint, text,
      appearance: Object.freeze(readMenuAppearance(config?.menuStyle)),
    });
    if (!snapshot.resources.get(root)?.has(htmlRendererToken.id)) return { value: text, menu };
    return { menu, value: renderCommandMenu(displayKey, menu.commands, menu.plugins, hint, text, {
      page, pages, locale, commandTotal: menu.commandTotal, pluginTotal: menu.pluginTotal, appearance: menu.appearance,
    }) };
  }
}

function commandDisplaySegments(record: CommandRecord, locale: Locale): readonly string[] {
  return record.preferredSegments[locale] ?? record.segments;
}

function commandDisplayName(record: CommandRecord, locale: Locale): string {
  return displayName(commandDisplaySegments(record, locale), record.parameter);
}

function commandLocale(source: unknown, snapshot: RuntimeSnapshot): Locale {
  const locale = source && typeof source === 'object' && 'locale' in source ? source.locale : undefined;
  return resolveLocale(locale ?? (snapshot.config.get(snapshot.root) as { locale?: unknown } | undefined)?.locale);
}

export function isCommandIndex(value: unknown): value is CommandIndex {
  return !!value && typeof value === 'object'
    && (value as { readonly $projection?: unknown }).$projection === 'zhin.command-index/1';
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

function compareRoutes(left: CommandRoute, right: CommandRoute): number {
  return dynamicWeight(left) - dynamicWeight(right)
    || staticSegmentCount(right.segments) - staticSegmentCount(left.segments)
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

function toDescriptor({
  slot: _slot,
  segments: _segments,
  parameter: _parameter,
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
