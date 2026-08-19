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
import {
  createCommandContext,
  resolveCommandSession,
  type CommandDefinition,
  type CommandParameterDefinition,
  type CommandParameterType,
  type CommandParameterValue,
  type CommandSegment,
  type CommandDynamicValue,
  type CommandPromptFactory,
  resolveDynamicParams,
} from './definition.js';
import { permissionHostToken, type PermissionHost } from '@zhin.js/permission';
import { toPermissionSubject } from '@zhin.js/permission';

export interface CommandParameterDescriptor extends CommandParameterDefinition {
  readonly required: boolean;
}

export interface CommandDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly source: string;
  readonly parameters: readonly CommandParameterDescriptor[];
  readonly alias?: readonly string[];
  readonly permit?: readonly string[];
  /** shortcut 触发键列表（不含预填 params）。 */
  readonly shortcut?: readonly string[];
}

export interface CommandDispatchResult {
  readonly matched: boolean;
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
      const primarySegments = runtimeSegments(slot.owner, slot.localName);
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
        source: slot.source,
        parameters: Object.freeze(parameter ? [{
          ...parameter,
          required: isRequiredParameter(parameter),
        }] : []),
        ...(alias ? { alias } : {}),
        ...(permit ? { permit } : {}),
        ...(shortcutKeys && shortcutKeys.length > 0 ? { shortcut: shortcutKeys } : {}),
        slot,
        segments: Object.freeze(primarySegments),
        parameter,
      });

      claim(occupancyKey(primarySegments, parameter), slot.source);
      routes.push({
        record,
        segments: primarySegments,
        matcher: new SegmentMatcher(matcherPattern(primarySegments, parameter), segmentFields),
        kind: 'primary',
      });

      if (alias) {
        for (const entry of alias) {
          const aliasSegments = aliasRuntimeSegments(slot.owner, entry, primarySegments);
          assertParameterSegment(aliasSegments, parameter, `${slot.source} alias ${JSON.stringify(entry)}`);
          claim(occupancyKey(aliasSegments, parameter), `${slot.source} alias ${JSON.stringify(entry)}`);
          routes.push({
            record,
            segments: Object.freeze(aliasSegments),
            matcher: new SegmentMatcher(matcherPattern(aliasSegments, parameter), segmentFields),
            kind: 'alias',
          });
        }
      }

      if (slot.definition.shortcut) {
        for (const [rawTrigger, prefill] of Object.entries(slot.definition.shortcut)) {
          const trigger = rawTrigger.trim();
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

  async execute(name: string, args: readonly string[] = []): Promise<unknown> {
    const match = this.#match(name, true);
    if (!match) {
      this.#diagnoseParameter(name);
      throw new Error(`Unknown Command: ${name}`);
    }
    // Host / 无 session：跳过 permit；无 source 时函数默认值得到空 session。
    return match.command.slot.definition.execute(
      createCommandContext(
        this.snapshot,
        match.command.slot.owner,
        args,
        resolveDynamicParams(match.params, undefined),
      ),
    );
  }

  async dispatch(
    input: CommandMatchInput,
    source: unknown = undefined,
    promptFactory?: CommandPromptFactory,
    commandPrefix = '',
  ): Promise<CommandDispatchResult> {
    if (this.#menu) {
      const menuValue = this.#dispatchMenu(input, commandPrefix);
      if (menuValue !== undefined) {
        return Object.freeze({
          matched: true,
          command: this.#menu.keyword,
          owner: this.snapshot.root,
          value: menuValue,
        });
      }
    }
    const prompt = promptFactory?.(source);
    const shortcut = this.#matchShortcut(input);
    if (shortcut) {
      if (!(await this.#permitAllows(shortcut.record, source))) {
        return Object.freeze({ matched: false });
      }
      const value = await shortcut.record.slot.definition.execute(
        createCommandContext(
          this.snapshot,
          shortcut.record.slot.owner,
          Object.freeze([]),
          resolveDynamicParams(shortcut.params, source),
          source,
          Object.freeze([]),
          prompt,
        ),
      );
      return Object.freeze({
        matched: true,
        command: shortcut.record.name,
        owner: shortcut.record.slot.owner,
        value,
      });
    }

    const match = this.#match(input, false);
    if (!match) return Object.freeze({ matched: false });
    if (!(await this.#permitAllows(match.command, source))) {
      return Object.freeze({ matched: false });
    }
    const args = textArgs(match.remaining);
    const value = await match.command.slot.definition.execute(
      createCommandContext(
        this.snapshot,
        match.command.slot.owner,
        args,
        resolveDynamicParams(match.params, source),
        source,
        match.remaining,
        prompt,
      ),
    );
    return Object.freeze({
      matched: true,
      command: match.command.name,
      owner: match.command.slot.owner,
      value,
    });
  }

  async #permitAllows(record: CommandRecord, source: unknown): Promise<boolean> {
    const permits = record.permit;
    if (!permits || permits.length === 0) return true;
    if (!hasImSession(source)) return true;
    const host = this.#resolveHost();
    if (!host) return false;
    const subject = toPermissionSubject(resolveCommandSession(source));
    return host.checkAll(permits, subject);
  }

  #resolveHost(): PermissionHost | undefined {
    try {
      const resources = this.snapshot.resources.get(this.snapshot.root);
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
      const result = route.matcher.match(asMatcherSegments(segments));
      if (!result || !hasCommandBoundary(result.remaining)) continue;
      const parameter = route.record.parameter;
      const params: Record<string, CommandDynamicValue> = { ...result.params };
      if (parameter?.rest) {
        const raw = result.params[parameter.name];
        const coerced = coerceRestValues(parameter, Array.isArray(raw) ? raw : []);
        if (!coerced || (isRequiredParameter(parameter) && coerced.length === 0)) continue;
        params[parameter.name] = coerced;
      }
      const remaining = normalizeSegments(result.remaining);
      if (exact && remaining.length > 0) continue;
      if (parameter && !parameter.rest && parameter.optional === true
        && parameter.defaultValue === undefined
        && (params[parameter.name] === '' || params[parameter.name] === null)) {
        delete params[parameter.name];
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
    const keyword = this.#menu!.keyword;
    if (text === keyword) return this.#buildMenu(undefined, commandPrefix);
    if (text.startsWith(keyword + ' ')) {
      const key = text.slice(keyword.length + 1).trim();
      if (key) return this.#buildMenu(key, commandPrefix);
      return this.#buildMenu(undefined, commandPrefix);
    }
    return undefined;
  }

  #buildMenu(pluginKey?: string, commandPrefix = ''): string {
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

    const keyword = this.#menu!.keyword;
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
 * 命令运行时名 = 插件树路径段（instanceKey，去掉 root）以 `.` 连接后，再与命令
 * 文件路径首段以 `.` 连接；命令内部嵌套段仍为空格分隔。Root 插件无前缀。
 * 例：`root/qq` + `endpoint/list` → `qq.endpoint list`；
 * `root/b/a` + `foo` → `b.a.foo`；root + `foo` → `foo`。
 */
function runtimeSegments(owner: string, localName: string): string[] {
  const localSegments = localName.split('/');
  if (owner === 'root') return localSegments;
  const prefix = owner.slice('root/'.length).split('/').join('.');
  return [`${prefix}.${localSegments[0]}`, ...localSegments.slice(1)];
}

/**
 * 用 alias 词序列替换全部本地静态段，再按 owner 规则重挂前缀；动态段保留。
 */
function aliasRuntimeSegments(
  owner: string,
  alias: string,
  primarySegments: readonly string[],
): string[] {
  const aliasTokens = alias.trim().split(/\s+/u).filter(Boolean);
  const dynamicTail = primarySegments.filter((segment) => segment.startsWith('$'));
  if (owner === 'root') return [...aliasTokens, ...dynamicTail];
  const prefix = owner.slice('root/'.length).split('/').join('.');
  return [`${prefix}.${aliasTokens[0]}`, ...aliasTokens.slice(1), ...dynamicTail];
}

function occupancyKey(
  segments: readonly string[],
  parameter: CommandParameterDefinition | undefined,
): string {
  return parameter ? routeShape(segments) : segments.join(' ');
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

function hasImSession(source: unknown): boolean {
  if (!source || typeof source !== 'object') return false;
  const conversation = (source as { conversation?: unknown }).conversation;
  return !!conversation && typeof conversation === 'object';
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
    + `segment and come after a static segment (child plugin commands are prefixed by the plugin `
    + `path, so a dynamic first segment is never reachable). `
    + (parameter
      ? `Hint: move the file under a static directory, e.g. "commands/add/[${parameter.name}:${parameter.type}].ts".`
      : 'Hint: put the file under a static directory, e.g. "commands/add/<file>.ts".'),
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
    return parameter.defaultValue === undefined
      ? `[${parameter.name}:${type}]`
      : `[${parameter.name}:${type}=${typeof parameter.defaultValue === 'function' ? '<dynamic>' : String(parameter.defaultValue)}]`;
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
