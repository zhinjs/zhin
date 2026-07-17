import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { defineAdapter, type EndpointInstance } from '@zhin.js/adapter';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import type { CapabilityId } from '@zhin.js/plugin-runtime';

interface TerminalConfig {
  readonly terminal?: {
    readonly interactive?: boolean;
    readonly prompt?: string;
  };
}

export interface TerminalEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly input: Readable;
  readonly output: Writable;
  readonly error: Writable;
  readonly interactive: boolean;
  readonly prompt: string;
}

export class TerminalEndpoint implements EndpointInstance {
  readonly #options: TerminalEndpointOptions;
  #readline?: ReadlineInterface;
  #promptTimer?: ReturnType<typeof setTimeout>;
  #open = false;

  constructor(options: TerminalEndpointOptions) {
    this.#options = options;
  }

  start(): void {
    if (!this.#options.interactive || this.#readline) return;
    const readline = createInterface({
      input: this.#options.input,
      output: this.#options.output,
      crlfDelay: Infinity,
      terminal: isTerminal(this.#options.input) && isTerminal(this.#options.output),
    });
    readline.setPrompt(this.#options.prompt);
    readline.on('line', (line) => {
      const content = line.trim();
      if (!this.#open) return;
      if (!content) {
        this.#schedulePrompt();
        return;
      }
      void this.#options.gateway.receive({
        adapter: this.#options.id,
        target: 'terminal',
        content,
        sender: 'local-user',
      }).catch((error: unknown) => {
        this.#options.error.write(`${formatError(error)}\n`);
      }).finally(() => {
        this.#schedulePrompt();
      });
    });
    this.#readline = readline;
  }

  open(): void {
    this.#open = true;
    this.#schedulePrompt();
  }

  close(): void {
    this.#open = false;
    this.#clearPrompt();
  }

  stop(): void {
    this.#open = false;
    this.#clearPrompt();
    this.#readline?.close();
    this.#readline = undefined;
  }

  send({ payload }: { readonly payload: unknown }): unknown {
    this.#options.output.write(`${formatPayload(payload)}\n`);
    return payload;
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
      gateway: context.use(messageGatewayToken),
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
