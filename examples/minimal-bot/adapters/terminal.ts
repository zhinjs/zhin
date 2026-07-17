import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { defineAdapter, type EndpointInstance } from '@zhin.js/adapter';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import type { CapabilityId } from '@zhin.js/plugin-runtime';

interface TerminalConfig {
  readonly terminal?: {
    readonly interactive?: boolean;
  };
}

export interface TerminalEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly input: Readable;
  readonly output: Writable;
  readonly error: Writable;
  readonly interactive: boolean;
}

export class TerminalEndpoint implements EndpointInstance {
  readonly #options: TerminalEndpointOptions;
  #readline?: ReadlineInterface;
  #open = false;

  constructor(options: TerminalEndpointOptions) {
    this.#options = options;
  }

  start(): void {
    if (!this.#options.interactive || this.#readline) return;
    const readline = createInterface({ input: this.#options.input, crlfDelay: Infinity });
    readline.on('line', (line) => {
      const content = line.trim();
      if (!this.#open || !content) return;
      void this.#options.gateway.receive({
        adapter: this.#options.id,
        target: 'terminal',
        content,
        sender: 'local-user',
      }).catch((error: unknown) => {
        this.#options.error.write(`${formatError(error)}\n`);
      });
    });
    this.#readline = readline;
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  stop(): void {
    this.#open = false;
    this.#readline?.close();
    this.#readline = undefined;
  }

  send({ payload }: { readonly payload: unknown }): unknown {
    this.#options.output.write(`${formatPayload(payload)}\n`);
    return payload;
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
    });
  },
});

function formatPayload(payload: unknown): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
