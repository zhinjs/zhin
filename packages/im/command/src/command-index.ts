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
  type CommandDefinition,
  type CommandParameterDefinition,
  type CommandParameterType,
  type CommandParameterValue,
  type CommandSegment,
} from './definition.js';

export interface CommandParameterDescriptor extends CommandParameterDefinition {
  readonly required: boolean;
}

export interface CommandDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly source: string;
  readonly parameters: readonly CommandParameterDescriptor[];
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
  readonly matcher: SegmentMatcher;
}

interface CommandMatch {
  readonly command: CommandRecord;
  readonly params: Readonly<Record<string, CommandParameterValue>>;
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

export class CommandIndex {
  readonly $projection = 'zhin.command-index/1' as const;
  readonly #commands: readonly CommandRecord[];

  constructor(
    slots: readonly Readonly<CapabilitySlot<CommandDefinition>>[],
    private readonly snapshot: RuntimeSnapshot,
  ) {
    const commands: CommandRecord[] = [];
    const staticCommands = new Map<string, CommandRecord>();
    const dynamicCommands = new Map<string, CommandRecord>();
    for (const slot of slots) {
      const segments = runtimeSegments(slot.owner, slot.localName);
      const parameter = slot.definition.$parameter;
      assertParameterSegment(segments, parameter, slot.source);
      const name = displayName(segments, parameter);
      const record: CommandRecord = Object.freeze({
        name,
        description: slot.definition.description,
        source: slot.source,
        parameters: Object.freeze(parameter ? [{
          ...parameter,
          required: isRequiredParameter(parameter),
        }] : []),
        slot,
        segments: Object.freeze(segments),
        parameter,
        matcher: new SegmentMatcher(matcherPattern(segments, parameter), segmentFields),
      });
      if (!parameter) {
        const key = segments.join(' ');
        if (staticCommands.has(key)) throw duplicateCommand(key);
        staticCommands.set(key, record);
      } else {
        const shape = routeShape(segments);
        if (dynamicCommands.has(shape)) throw duplicateCommand(name);
        dynamicCommands.set(shape, record);
      }
      commands.push(record);
    }
    this.#commands = Object.freeze(commands.sort(compareCommands));
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
    return match.command.slot.definition.execute(
      createCommandContext(
        this.snapshot,
        match.command.slot.owner,
        args,
        match.params,
      ),
    );
  }

  async dispatch(
    input: CommandMatchInput,
    source: unknown = undefined,
  ): Promise<CommandDispatchResult> {
    const match = this.#match(input, false);
    if (!match) return Object.freeze({ matched: false });
    const args = textArgs(match.remaining);
    const value = await match.command.slot.definition.execute(
      createCommandContext(
        this.snapshot,
        match.command.slot.owner,
        args,
        match.params,
        source,
        match.remaining,
      ),
    );
    return Object.freeze({
      matched: true,
      command: match.command.name,
      owner: match.command.slot.owner,
      value,
    });
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

    for (const command of this.#commands) {
      const result = command.matcher.match(asMatcherSegments(segments));
      if (!result || !hasCommandBoundary(result.remaining)) continue;
      const parameter = command.parameter;
      const params: Record<string, CommandParameterValue> = { ...result.params };
      if (parameter?.rest) {
        const raw = result.params[parameter.name];
        const coerced = coerceRestValues(parameter, Array.isArray(raw) ? raw : []);
        // 必需 `[...name]` 捕获所有：零元素视为不匹配；标量逐词转换失败同样不匹配。
        if (!coerced || (isRequiredParameter(parameter) && coerced.length === 0)) continue;
        params[parameter.name] = coerced;
      }
      const remaining = normalizeSegments(result.remaining);
      if (exact && remaining.length > 0) continue;
      // `[[name]]` 无 default 且未命中时，matcher 对 text 回退 ''、其他类型回退 null；
      // 按契约（省略 default 时未匹配为 undefined）删除该键。
      if (parameter && !parameter.rest && parameter.optional === true
        && parameter.defaultValue === undefined
        && (params[parameter.name] === '' || params[parameter.name] === null)) {
        delete params[parameter.name];
      }
      return {
        command,
        params: Object.freeze(params),
        remaining,
      };
    }
    return undefined;
  }

  #diagnoseParameter(name: string): void {
    const words = splitCommand(name);
    for (const command of this.#commands) {
      const parameter = command.parameter;
      if (!parameter || parameter.rest) continue;
      const parameterIndex = command.segments.findIndex((segment) => segment.startsWith('$'));
      if (words.length !== command.segments.length) continue;
      if (!command.segments.every((segment, index) =>
        index === parameterIndex || segment === words[index])) continue;
      const value = words[parameterIndex];
      if (value === undefined || matchesParameter(parameter.type, value)) continue;
      throw new CommandParameterValueError(parameter.name, parameter.type, value);
    }
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
  throw new Error(`Broken dynamic Command identity for ${source}`);
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
    // rest：结构化类型按消息段收集；标量类型先按 text 段收集，再在 #match 里逐词切分转换。
    if (parameter.rest) {
      return `[...${parameter.name}:${isStructuredRestType(parameter.type) ? type : 'text'}]`;
    }
    if (isRequiredParameter(parameter)) return `<${parameter.name}:${type}>`;
    return parameter.defaultValue === undefined
      ? `[${parameter.name}:${type}]`
      : `[${parameter.name}:${type}=${String(parameter.defaultValue)}]`;
  }).join(' ');
}

function matcherType(type: CommandParameterType): string {
  return type === 'string' ? 'word' : type;
}

function routeShape(segments: readonly string[]): string {
  return segments.map((segment) => segment.startsWith('$') ? '$' : segment).join(' ');
}

function compareCommands(left: CommandRecord, right: CommandRecord): number {
  return dynamicWeight(left) - dynamicWeight(right)
    || staticSegmentCount(right.segments) - staticSegmentCount(left.segments)
    || right.segments.length - left.segments.length
    || right.name.length - left.name.length
    || left.name.localeCompare(right.name);
}

/** 静态 < 单参数 < 捕获所有：更具体的形状优先匹配。 */
function dynamicWeight(command: CommandRecord): number {
  if (!command.parameter) return 0;
  return command.parameter.rest ? 2 : 1;
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
  matcher: _matcher,
  ...descriptor
}: CommandRecord): CommandDescriptor {
  return descriptor;
}

function duplicateCommand(name: string): Error {
  return new Error(`Duplicate runtime Command: ${name}`);
}

export class CommandParameterValueError extends TypeError {
  constructor(name: string, type: CommandParameterType, value: string) {
    super(`Invalid value for Command parameter ${name}:${type}: ${value}`);
    this.name = 'CommandParameterValueError';
  }
}
