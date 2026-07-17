import type {
  CapabilitySlot,
  RuntimeSnapshot,
} from '@zhin.js/next-kernel';
import { createCommandContext, type CommandDefinition } from './definition.js';

export interface CommandDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly source: string;
}

interface CommandRecord extends CommandDescriptor {
  readonly slot: Readonly<CapabilitySlot<CommandDefinition>>;
}

export class CommandIndex {
  readonly #commands = new Map<string, CommandRecord>();

  constructor(
    slots: readonly Readonly<CapabilitySlot<CommandDefinition>>[],
    private readonly snapshot: RuntimeSnapshot,
  ) {
    for (const slot of slots) {
      const name = runtimeName(slot.owner, slot.localName);
      if (this.#commands.has(name)) throw new Error(`Duplicate runtime Command: ${name}`);
      this.#commands.set(name, Object.freeze({
        name,
        description: slot.definition.description,
        source: slot.source,
        slot,
      }));
    }
  }

  list(): readonly CommandDescriptor[] {
    return [...this.#commands.values()].map(({ slot: _slot, ...descriptor }) => descriptor);
  }

  has(name: string): boolean {
    return this.#commands.has(name);
  }

  async execute(name: string, args: readonly string[] = []): Promise<unknown> {
    const command = this.#commands.get(name);
    if (!command) throw new Error(`Unknown Command: ${name}`);
    return command.slot.definition.execute(
      createCommandContext(this.snapshot, command.slot.owner, args),
    );
  }
}

function runtimeName(owner: string, localName: string): string {
  return owner === 'root' ? localName : `${owner.slice('root/'.length)}/${localName}`;
}
