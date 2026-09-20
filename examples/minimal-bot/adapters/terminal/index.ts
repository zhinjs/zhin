import {
  defineAdapter,
  type EndpointImplementation,
} from 'zhin.js/adapter';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

interface TerminalConfig {
  readonly terminal?: {
    readonly interactive?: boolean;
    readonly prompt?: string;
  };
}

export interface TerminalEndpointOptions {
  readonly input: Readable;
  readonly output: Writable;
  readonly error: Writable;
  readonly interactive: boolean;
  readonly prompt: string;
}

export class TerminalClient {
  readonly input: Readable;
  readonly output: Writable;
  readonly error: Writable;
  private readonly resolveReadline: () => ReadlineInterface | undefined;

  constructor(
    input: Readable,
    output: Writable,
    error: Writable,
    resolveReadline: () => ReadlineInterface | undefined,
  ) {
    this.input = input;
    this.output = output;
    this.error = error;
    this.resolveReadline = resolveReadline;
  }

  get readline(): ReadlineInterface | undefined {
    return this.resolveReadline();
  }

  write(payload: unknown): void {
    this.output.write(`${formatPayload(payload)}\n`);
  }
}

export function createTerminalEndpoint(
  options: TerminalEndpointOptions,
): EndpointImplementation<TerminalClient> {
  let readline: ReadlineInterface | undefined;
  let promptTimer: ReturnType<typeof setTimeout> | undefined;
  let messageSequence = 0;
  const client = new TerminalClient(
    options.input,
    options.output,
    options.error,
    () => readline,
  );

  const clearPrompt = () => {
    if (!promptTimer) return;
    clearTimeout(promptTimer);
    promptTimer = undefined;
  };
  const schedulePrompt = () => {
    clearPrompt();
    // Let the CLI print its startup summary before the interactive prompt.
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
      // In raw TTY mode Ctrl+C is a readline event, not an OS process signal.
      readline.on('SIGINT', () => process.emit('SIGINT'));
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
