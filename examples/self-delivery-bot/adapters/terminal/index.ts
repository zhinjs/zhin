import { defineAdapter, type EndpointImplementation } from 'zhin.js/adapter';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

interface TerminalConfig {
  readonly terminal?: {
    readonly interactive?: boolean;
    readonly prompt?: string;
  };
}

interface TerminalOptions {
  readonly input: Readable;
  readonly output: Writable;
  readonly error: Writable;
  readonly interactive: boolean;
  readonly prompt: string;
}

class TerminalClient {
  readonly output: Writable;
  private readonly resolveReadline: () => ReadlineInterface | undefined;

  constructor(output: Writable, resolveReadline: () => ReadlineInterface | undefined) {
    this.output = output;
    this.resolveReadline = resolveReadline;
  }

  get readline(): ReadlineInterface | undefined {
    return this.resolveReadline();
  }

  write(payload: unknown): void {
    this.output.write(`${formatPayload(payload)}\n`);
  }
}

function createTerminalEndpoint(options: TerminalOptions): EndpointImplementation<TerminalClient> {
  let readline: ReadlineInterface | undefined;
  let promptTimer: ReturnType<typeof setTimeout> | undefined;
  let messageSequence = 0;
  const client = new TerminalClient(options.output, () => readline);
  const clearPrompt = () => {
    if (!promptTimer) return;
    clearTimeout(promptTimer);
    promptTimer = undefined;
  };
  const schedulePrompt = () => {
    clearPrompt();
    promptTimer = setTimeout(() => {
      promptTimer = undefined;
      readline?.prompt();
    }, 0);
  };

  return {
    client,
    activate({ events }) {
      if (!options.interactive) return;
      readline = createInterface({
        input: options.input,
        output: options.output,
        crlfDelay: Infinity,
        terminal: isTerminal(options.input) && isTerminal(options.output),
      });
      readline.setPrompt(options.prompt);
      readline.on('line', (line) => {
        void events.platform('line', line).catch((error) => {
          options.error.write(`${formatError(error)}\n`);
        });
        const content = line.trim();
        if (!content) {
          schedulePrompt();
          return;
        }
        void events.message({
          conversation: { kind: 'private', id: 'terminal' },
          content,
          sender: { id: 'local-user' },
        }).catch((error: unknown) => {
          options.error.write(`${formatError(error)}\n`);
        }).finally(schedulePrompt);
      });
      schedulePrompt();
      return () => {
        clearPrompt();
        readline?.close();
        readline = undefined;
      };
    },
    send({ payload }) {
      client.write(payload);
      messageSequence += 1;
      return `terminal-${messageSequence}`;
    },
  };
}

export default defineAdapter<TerminalConfig, TerminalClient>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    return createTerminalEndpoint({
      input: process.stdin,
      output: process.stdout,
      error: process.stderr,
      interactive: context.config.terminal?.interactive ?? true,
      prompt: context.config.terminal?.prompt ?? 'delivery> ',
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
