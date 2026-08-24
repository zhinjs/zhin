import { Endpoint, defineAdapter } from 'zhin.js/adapter';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { CapabilityId } from 'zhin.js';

interface TerminalConfig {
  readonly terminal?: {
    readonly interactive?: boolean;
    readonly prompt?: string;
  };
}

export interface TerminalEndpointOptions {
  readonly id: CapabilityId;
  readonly input: Readable;
  readonly output: Writable;
  readonly error: Writable;
  readonly interactive: boolean;
  readonly prompt: string;
}

export class TerminalClient {
  constructor(
    readonly input: Readable,
    readonly output: Writable,
    readonly error: Writable,
    private readonly resolveReadline: () => ReadlineInterface | undefined,
  ) {}

  get readline(): ReadlineInterface | undefined {
    return this.resolveReadline();
  }

  write(payload: unknown): void {
    this.output.write(`${formatPayload(payload)}\n`);
  }
}

export class TerminalEndpoint extends Endpoint<TerminalClient> {
  readonly client: TerminalClient;
  readonly #options: TerminalEndpointOptions;
  #messageSequence = 0;
  #readline?: ReadlineInterface;
  #promptTimer?: ReturnType<typeof setTimeout>;
  #open = false;
  #stopped = false;

  constructor(options: TerminalEndpointOptions) {
    super();
    this.#options = options;
    this.client = new TerminalClient(
      options.input,
      options.output,
      options.error,
      () => this.#readline,
    );
  }

  start(): void {
    if (!this.#options.interactive || this.#readline || this.#stopped) return;
    const readline = createInterface({
      input: this.#options.input,
      output: this.#options.output,
      crlfDelay: Infinity,
      terminal: isTerminal(this.#options.input) && isTerminal(this.#options.output),
    });
    readline.setPrompt(this.#options.prompt);
    readline.on('line', (line) => {
      void this.emitPlatform('line', line).catch((error) => {
        this.#options.error.write(`${formatError(error)}\n`);
      });
      const content = line.trim();
      if (!this.#open) return;
      if (!content) {
        this.#schedulePrompt();
        return;
      }
      const endpointKey = String(this.#options.id);
      void this.emit('message.receive', {
        conversation: {
          endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
          kind: 'private',
          id: 'terminal',
        },
        content,
        sender: { id: 'local-user' },
      }).catch((error: unknown) => {
        this.#options.error.write(`${formatError(error)}\n`);
      }).finally(() => {
        this.#schedulePrompt();
      });
    });
    this.#readline = readline;
  }

  open(): void {
    if (this.#stopped) throw new Error('Terminal Endpoint cannot reopen after stop');
    // Candidate rollback stops only this candidate; the committed Endpoint is untouched.
    this.start();
    this.#open = true;
    this.#schedulePrompt();
  }

  close(): void {
    this.#open = false;
    this.#clearPrompt();
    // readline.close() pauses its input. Release it before the next generation starts so the
    // old projection's deferred stop cannot pause a stream already owned by the new Endpoint.
    this.#releaseReadline();
  }

  stop(): void {
    this.#open = false;
    this.#stopped = true;
    this.#clearPrompt();
    this.#releaseReadline();
  }

  #releaseReadline(): void {
    this.#readline?.close();
    this.#readline = undefined;
  }

  send({ payload }: { readonly payload: unknown }): string {
    this.client.write(payload);
    this.#messageSequence += 1;
    return `terminal-${this.#messageSequence}`;
  }

  #schedulePrompt(): void {
    this.#clearPrompt();
    // Root activation finishes before the CLI prints its startup summary. A timer keeps the
    // interactive prompt as the final line without coupling the Adapter to the CLI.
    this.#promptTimer = setTimeout(() => {
      this.#promptTimer = undefined;
      if (this.#open) this.#readline?.prompt();
    }, 0);
  }

  #clearPrompt(): void {
    if (!this.#promptTimer) return;
    clearTimeout(this.#promptTimer);
    this.#promptTimer = undefined;
  }
}

export default defineAdapter<TerminalConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    return new TerminalEndpoint({
      id: context.id,
      input: process.stdin,
      output: process.stdout,
      error: process.stderr,
      interactive: context.config.terminal?.interactive ?? true,
      prompt: context.config.terminal?.prompt ?? 'zhin> ',
    });
  },
});

function isTerminal(stream: Readable | Writable): boolean {
  return (stream as Readable & { readonly isTTY?: boolean }).isTTY === true;
}

function formatPayload(payload: unknown): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
