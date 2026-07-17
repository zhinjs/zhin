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
}

interface CommandMatch {
  readonly command: CommandRecord;
  readonly params: Readonly<Record<string, CommandParameterValue>>;
}

export class CommandIndex {
  readonly #commands: readonly CommandRecord[];
  readonly #staticCommands = new Map<string, CommandRecord>();
  readonly #dynamicCommands = new Map<string, CommandRecord>();

  constructor(
    slots: readonly Readonly<CapabilitySlot<CommandDefinition>>[],
    private readonly snapshot: RuntimeSnapshot,
  ) {
    const commands: CommandRecord[] = [];
    for (const slot of slots) {
      const segments = runtimeSegments(slot.owner, slot.localName);
      const parameter = slot.definition.$parameter;
      assertParameterSegment(segments, parameter, slot.source);
      const name = displayName(segments, parameter);
      const record = Object.freeze({
        name,
        description: slot.definition.description,
        source: slot.source,
        parameters: Object.freeze(parameter ? [{
          ...parameter,
          required: parameter.defaultValue === undefined,
        }] : []),
        slot,
        segments: Object.freeze(segments),
        parameter,
      });
      if (!parameter) {
        const key = segments.join(' ');
        if (this.#staticCommands.has(key)) throw duplicateCommand(key);
        this.#staticCommands.set(key, record);
      } else {
        const shape = routeShape(segments);
        if (this.#dynamicCommands.has(shape)) throw duplicateCommand(name);
        this.#dynamicCommands.set(shape, record);
      }
      commands.push(record);
    }
    this.#commands = Object.freeze(commands);
  }

  list(): readonly CommandDescriptor[] {
    return this.#commands.map(toDescriptor);
  }

  has(name: string): boolean {
    try {
      return this.#match(name) !== undefined;
    } catch (error) {
      if (error instanceof CommandParameterValueError) return false;
      throw error;
    }
  }

  async execute(name: string, args: readonly string[] = []): Promise<unknown> {
    const match = this.#match(name);
    if (!match) throw new Error(`Unknown Command: ${name}`);
    return match.command.slot.definition.execute(
      createCommandContext(
        this.snapshot,
        match.command.slot.owner,
        args,
        match.params,
      ),
    );
  }

  async dispatch(input: string, source: unknown = undefined): Promise<CommandDispatchResult> {
    const words = splitCommand(input);
    for (let consumed = words.length; consumed > 0; consumed -= 1) {
      const match = this.#match(words.slice(0, consumed).join(' '));
      if (!match) continue;
      const args = words.slice(consumed);
      const value = await match.command.slot.definition.execute(
        createCommandContext(
          this.snapshot,
          match.command.slot.owner,
          args,
          match.params,
          source,
        ),
      );
      return Object.freeze({
        matched: true,
        command: match.command.name,
        owner: match.command.slot.owner,
        value,
      });
    }
    return Object.freeze({ matched: false });
  }

  #match(name: string): CommandMatch | undefined {
    const words = splitCommand(name);
    // A literal file such as list.ts always wins over [name:string].ts.
    const staticCommand = this.#staticCommands.get(words.join(' '));
    if (staticCommand) return { command: staticCommand, params: Object.freeze({}) };

    for (const command of this.#dynamicCommands.values()) {
      const parameter = command.parameter as CommandParameterDefinition;
      const optional = parameter.defaultValue !== undefined;
      if (words.length !== command.segments.length &&
        !(optional && words.length === command.segments.length - 1)) continue;
      const parameterIndex = command.segments.findIndex((segment) => segment.startsWith('$'));
      if (!command.segments.every((segment, index) =>
        index === parameterIndex || segment === words[index])) continue;
      const rawValue = words[parameterIndex];
      const value = rawValue === undefined
        ? parameter.defaultValue as CommandParameterValue
        : parseRuntimeValue(parameter, rawValue);
      return {
        command,
        params: Object.freeze({ [parameter.name]: value }),
      };
    }
    return undefined;
  }
}

function runtimeSegments(owner: string, localName: string): string[] {
  const ownerSegments = owner === 'root'
    ? []
    : owner.slice('root/'.length).split('/');
  return [...ownerSegments, ...localName.split('/')];
}

function assertParameterSegment(
  segments: readonly string[],
  parameter: CommandParameterDefinition | undefined,
  source: string,
): void {
  const dynamicSegments = segments.filter((segment) => segment.startsWith('$'));
  if (!parameter && dynamicSegments.length === 0) return;
  if (parameter && dynamicSegments.length === 1 &&
    dynamicSegments[0] === `$${parameter.name}` &&
    segments.at(-1) === dynamicSegments[0]) return;
  throw new Error(`Broken dynamic Command identity for ${source}`);
}

function displayName(
  segments: readonly string[],
  parameter: CommandParameterDefinition | undefined,
): string {
  return segments.map((segment) => {
    if (!segment.startsWith('$')) return segment;
    return parameter?.defaultValue === undefined
      ? `<${segment.slice(1)}>`
      : `[${segment.slice(1)}]`;
  }).join(' ');
}

function routeShape(segments: readonly string[]): string {
  return segments.map((segment) => segment.startsWith('$') ? '$' : segment).join(' ');
}

function splitCommand(value: string): readonly string[] {
  const normalized = value.trim();
  return normalized ? normalized.split(/\s+/) : [];
}

function parseRuntimeValue(
  parameter: CommandParameterDefinition,
  value: string,
): CommandParameterValue {
  if (parameter.type === 'string') return value;
  if (parameter.type === 'number') {
    const number = Number(value);
    if (value.trim().length > 0 && Number.isFinite(number)) return number;
  } else if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  throw new CommandParameterValueError(parameter.name, parameter.type, value);
}

function toDescriptor({
  slot: _slot,
  segments: _segments,
  parameter: _parameter,
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
