import {
  SegmentMatcher,
  TypeMatcherRegistry,
  type MessageSegment,
} from 'segment-matcher';
import type {
  CapabilitySlot,
  PluginId,
  RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { UserInteractionFactory } from '@zhin.js/interaction';
import { bindOperationInput, operationClientAdapter } from '@zhin.js/feature-kit';
import {
  permissionHostToken,
  toPermissionSubject,
  type PermissionHost,
} from '@zhin.js/permission';
import { commandUsage, commandHelp, parseCommandArguments, type CommandValidationIssue } from './arguments.js';
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
  readonly name: string;
  readonly description?: string;
  readonly adapter?: string;
  readonly source: string;
  readonly parameters: readonly CommandParameterDescriptor[];
  readonly usage: string;
  readonly options: NonNullable<CommandDefinition['options']>;
  readonly alias?: readonly string[];
  readonly permit?: readonly string[];
  /** shortcut 触发键列表（不含预填 params）。 */
  readonly shortcut?: readonly string[];
}

export interface CommandDispatchResult {
  readonly matched: boolean;
  readonly status: 'unmatched' | 'invalid' | 'denied' | 'executed';
  readonly issues?: readonly CommandValidationIssue[];
  readonly help?: string;
  readonly command?: string;
  readonly owner?: PluginId;
  readonly value?: unknown;
}

interface CommandRecord extends CommandDescriptor {
  readonly slot: Readonly<CapabilitySlot<CommandDefinition>>;
  readonly segments: readonly string[];
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
  readonly keyword: string;
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

    const claim = (key: string, source: string): void => {
      const existing = occupancy.get(key);
      if (existing !== undefined) {
        throw new Error(`Duplicate Command route "${key}" (${source} vs ${existing})`);
      }
      occupancy.set(key, source);
    };

    for (const slot of slots) {
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

      const record: CommandRecord = Object.freeze({
        name,
        description: slot.definition.description,
        ...(slot.definition.adapter ? { adapter: slot.definition.adapter } : {}),
        source: slot.source,
        usage: commandUsage(name, slot.definition),
        options: Object.freeze({ ...slot.definition.options }),
        parameters: Object.freeze(Object.entries(slot.definition.params ?? {}).map(([key, schema]) => ({
          name: key, ...schema, ...(parameter?.name === key ? parameter : {}), defaultValue: schema.default,
          required: parameter?.name === key ? isRequiredParameter(parameter) : !schema.optional && schema.default === undefined,
        }))),
        ...(alias ? { alias } : {}),
        ...(permit ? { permit } : {}),
        ...(shortcutKeys && shortcutKeys.length > 0 ? { shortcut: shortcutKeys } : {}),
        slot,
        segments: Object.freeze(primarySegments),
        parameter,
      });

      claim(occupancyKey(primarySegments, parameter), slot.source);
      const argumentShape = declaredRouteShape(primarySegments, slot.definition);
      if (argumentShape !== occupancyKey(primarySegments, parameter)) claim(argumentShape, slot.source);
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
          claim(occupancyKey(aliasSegments, parameter), `${slot.source} alias ${JSON.stringify(entry)}`);
          const argumentShape = declaredRouteShape(aliasSegments, slot.definition);
          if (argumentShape !== occupancyKey(aliasSegments, parameter)) claim(argumentShape, `${slot.source} alias ${JSON.stringify(entry)}`);
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
          claim(trigger, `${slot.source} shortcut ${JSON.stringify(trigger)}`);
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

  list(): readonly CommandDescriptor[] {
    return this.#commands.map(toDescriptor);
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
    const match = this.#match(name, false);
    if (!match) {
      this.#diagnoseParameter(name);
      throw new Error(`Unknown Command: ${name}`);
    }
    if (!(await this.#permitAllows(match.command, undefined, operationSnapshot))) throw new Error(`Permission denied for Command: ${match.command.name}`);
    const definition = match.command.slot.definition;
    const supplied = [...match.remaining, ...(args.length > 0 ? [{ type: 'text', data: { text: args.join(' ') } }] : [])];
    const parsed = parseCommandArguments(definition, supplied, resolveDynamicParams(match.params, undefined), {});
    if (parsed.issues.length > 0) throw new CommandArgumentValidationError(parsed.issues, commandHelp(match.command.name, definition));
    return definition.execute(createCommandContext(operationSnapshot, match.command.slot.owner,
      textArgs(parsed.remaining), parsed.params, undefined, parsed.remaining, undefined, definition.adapter, parsed.options));
  }

  async dispatch(
    input: CommandMatchInput,
    source: unknown = undefined,
    interactionFactory?: UserInteractionFactory,
    commandPrefix = '',
    operationSnapshot: RuntimeSnapshot = this.snapshot,
  ): Promise<CommandDispatchResult> {
    if (this.#menu) {
      const menuValue = this.#dispatchMenu(input, commandPrefix);
      if (menuValue !== undefined) {
        return Object.freeze({
          matched: true,
          status: 'executed',
          command: this.#menu.keyword,
          owner: operationSnapshot.root,
          value: menuValue,
        });
      }
    }
    const shortcut = this.#matchShortcut(input);
    const match = shortcut
      ? { command: shortcut.record, params: shortcut.params, remaining: Object.freeze([]) }
      : this.#match(input, false);
    if (!match) {
      const candidate = this.#invalidRoute(input);
      if (!candidate) return Object.freeze({ matched: false, status: 'unmatched' });
      if (!commandAdapterMatches(candidate, source)) return Object.freeze({ matched: false, status: 'unmatched' });
      if (!(await this.#permitAllows(candidate, source, operationSnapshot))) return this.#denied(candidate);
      const help = commandHelp(candidate.name, candidate.slot.definition, commandPrefix);
      const text = exactMessageText(input);
      if (text && /(?:^|\s)--help$/u.test(text)) return Object.freeze({ matched: true, status: 'executed', command: candidate.name, owner: candidate.slot.owner, value: help });
      return Object.freeze({ matched: true, status: 'invalid', command: candidate.name, owner: candidate.slot.owner,
        issues: Object.freeze([{ field: candidate.parameter?.name ?? 'arguments', message: 'Missing or invalid command parameter' }]), help });
    }
    if (!commandAdapterMatches(match.command, source)) return Object.freeze({ matched: false, status: 'unmatched' });
    if (!(await this.#permitAllows(match.command, source, operationSnapshot))) return this.#denied(match.command);
    const definition = match.command.slot.definition;
    const authorSource = bindOperationInput(source, match.command.slot.owner, operationSnapshot);
    const help = commandHelp(match.command.name, definition, commandPrefix);
    if (exactMessageText(match.remaining) === '--help') {
      return Object.freeze({ matched: true, status: 'executed', command: match.command.name, owner: match.command.slot.owner, value: help });
    }
    const parsed = parseCommandArguments(definition, match.remaining, resolveDynamicParams(match.params, authorSource), resolveCommandSession(authorSource));
    if (parsed.issues.length > 0) return Object.freeze({ matched: true, status: 'invalid', command: match.command.name,
      owner: match.command.slot.owner, issues: parsed.issues, help });
    const value = await definition.execute(createCommandContext(operationSnapshot, match.command.slot.owner,
      textArgs(parsed.remaining), parsed.params, authorSource, parsed.remaining, interactionFactory?.(authorSource), definition.adapter, parsed.options));
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
    const projected = toPermissionSubject(source);
    const session = resolveCommandSession(source);
    const subject = { ...projected, ...session, ...(session.sender ? { sender: { ...projected.sender, ...session.sender } } : {}) };
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
      const parseDeclaredArguments = !exact && route.record.parameter && route.record.slot.definition.options !== undefined && route.literalMatcher !== undefined;
      const result = (parseDeclaredArguments && route.literalMatcher ? route.literalMatcher : route.matcher).match(asMatcherSegments(segments));
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

  #dispatchMenu(input: CommandMatchInput, commandPrefix = ''): string | undefined {
    const text = typeof input === 'string' ? input.trim() : exactMessageText(input);
    if (text === undefined) return undefined;
    const menu = this.#menu;
    if (!menu) return undefined;
    const keyword = menu.keyword;
    if (text === keyword) return this.#buildMenu(undefined, commandPrefix, keyword);
    if (text.startsWith(keyword + ' ')) {
      const key = text.slice(keyword.length + 1).trim();
      if (key) return this.#buildMenu(key, commandPrefix, keyword);
      return this.#buildMenu(undefined, commandPrefix, keyword);
    }
    return undefined;
  }

  #buildMenu(pluginKey: string | undefined, commandPrefix: string, keyword: string): string {
    const root = this.snapshot.root;
    const targetId = pluginKey
      ? `${root}/${pluginKey.split('.').join('/')}` as PluginId
      : root;

    const node = this.snapshot.tree.get(targetId);
    if (!node) return `未找到插件: ${pluginKey}`;

    const directCommands = this.#commands.filter((cmd) => cmd.slot.owner === targetId);
    const children = node.children
      .map((childId) => this.snapshot.tree.get(childId))
      .filter((child): child is NonNullable<typeof child> => !!child);

    const displayKey = pluginKey ?? node.instanceKey;
    const lines: string[] = [`=== ${displayKey} 指令菜单 ===`];

    if (directCommands.length > 0) {
      lines.push('');
      for (const cmd of directCommands) {
        const desc = cmd.description ? `  - ${cmd.description}` : '';
        lines.push(`  ${commandPrefix}${cmd.name}${desc}`);
      }
    }

    if (children.length > 0) {
      lines.push('');
      lines.push('子插件：');
      for (const child of children) {
        const childKey = pluginKey ? `${pluginKey}.${child.instanceKey}` : child.instanceKey;
        const label = child.metadata?.displayName ?? child.instanceKey;
        lines.push(`  ${childKey}  (${label})`);
      }
    }

    if (directCommands.length === 0 && children.length === 0) {
      lines.push('');
      lines.push('（暂无指令和子插件）');
    }

    if (children.length > 0) {
      lines.push('');
      lines.push(`提示：使用「${commandPrefix}${keyword} <插件名>」查看子插件的指令`);
    }

    return lines.join('\n');
  }
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

function declaredRouteShape(segments: readonly string[], definition: CommandDefinition): string {
  const argumentsTail = Object.keys(definition.params ?? {}).filter((name) => name !== definition.$parameter?.name).map(() => '$');
  return [...segments.map((segment) => segment.startsWith('$') ? '$' : segment), ...argumentsTail].join(' ');
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

function assertParameterSegment(
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

function commandAdapterMatches(record: CommandRecord, source: unknown): boolean {
  return !record.adapter || operationClientAdapter(source) === record.adapter;
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
