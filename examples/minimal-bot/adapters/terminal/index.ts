import { Adapter, createEndpointSpecification, defineAdapter, endpointSpec,
  type Endpoint, type EndpointSpecification, type EndpointTransportState } from 'zhin.js/adapter';
import { EventEmitter } from 'node:events';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

interface TerminalConfig {
  readonly terminal?: { readonly interactive?: boolean; readonly prompt?: string };
}
export interface TerminalEndpointOptions {
  readonly input: Readable;
  readonly output: Writable;
  readonly error: Writable;
  readonly interactive: boolean;
  readonly prompt: string;
}

/** Owns terminal IO; the Endpoint never supplies a callback to find Client state. */
export class TerminalClient extends EventEmitter<{ line: [line: string] }> {
  readonly input: Readable;
  readonly output: Writable;
  readonly error: Writable;
  readonly #options: TerminalEndpointOptions;
  #readline?: ReadlineInterface;
  #promptTimer?: ReturnType<typeof setTimeout>;
  #state: EndpointTransportState = 'idle';
  #sequence = 0;

  constructor(options: TerminalEndpointOptions) {
    super(); this.#options = options;
    this.input = options.input; this.output = options.output; this.error = options.error;
  }
  get readline(): ReadlineInterface | undefined { return this.#readline; }
  get transportState(): EndpointTransportState { return this.#state; }
  write(payload: unknown): string {
    this.output.write(`${formatPayload(payload)}\n`);
    return `terminal-${++this.#sequence}`;
  }
  openInput(): void {
    this.#state = 'open';
    if (!this.#options.interactive) return;
    this.#readline = createInterface({ input: this.input, output: this.output,
      crlfDelay: Infinity, terminal: isTerminal(this.input) && isTerminal(this.output) });
    this.#readline.setPrompt(this.#options.prompt);
    this.#readline.on('close', () => {
      this.#clearPrompt();
      if (this.#state === 'open') this.#state = 'closed';
    });
    // In raw TTY mode Ctrl+C is a readline event, not an OS process signal.
    this.#readline.on('SIGINT', () => process.emit('SIGINT'));
    this.#readline.on('line', line => this.emit('line', line));
    this.schedulePrompt();
  }
  closeInput(): void {
    this.#state = 'closed'; this.#clearPrompt(); this.#readline?.close(); this.#readline = undefined;
  }
  stopInput(): void { this.closeInput(); this.#state = 'stopped'; }
  protected schedulePrompt(): void {
    this.#clearPrompt();
    if (this.#state !== 'open') return;
    // Let the CLI print its startup summary before the interactive prompt.
    this.#promptTimer = setTimeout(() => { this.#promptTimer = undefined; this.#readline?.prompt(); }, 0);
  }
  #clearPrompt(): void {
    if (this.#promptTimer !== undefined) clearTimeout(this.#promptTimer);
    this.#promptTimer = undefined;
  }
}

export class TerminalEndpoint extends TerminalClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  constructor(options: TerminalEndpointOptions) {
    super(options);
    const endpoint = this;
    this[endpointSpec] = createEndpointSpecification(this, {
    start: signal => signal.throwIfAborted(),
    open: () => { this.on('line', this.#receiveLine); this.openInput(); },
    close: () => { this.off('line', this.#receiveLine); this.closeInput(); },
    stop: () => { this.off('line', this.#receiveLine); this.stopInput(); },
    send: request => this.write(request.payload),
    get transportState() { return endpoint.transportState; },
    });
  }
  readonly #receiveLine = (line: string): void => {
    const events = this[endpointSpec].events;
    void events.platform('line', line).catch(error => this.error.write(`${formatError(error)}\n`));
    const content = line.trim();
    if (!content) { this.schedulePrompt(); return; }
    void events.message({ conversation: { kind: 'private', id: 'terminal' }, content, sender: { id: 'local-user' } })
      .catch(error => this.error.write(`${formatError(error)}\n`)).finally(() => this.schedulePrompt());
  };
}

export function createTerminalEndpoint(options: TerminalEndpointOptions): TerminalEndpoint {
  return new TerminalEndpoint(options);
}
class TerminalAdapter extends Adapter<TerminalEndpoint, TerminalConfig> {
  protected createEndpoint(config: TerminalConfig): TerminalEndpoint {
    return new TerminalEndpoint({ input: process.stdin, output: process.stdout, error: process.stderr,
      interactive: config.terminal?.interactive ?? true, prompt: config.terminal?.prompt ?? 'zhin> ' });
  }
}
export default defineAdapter<TerminalConfig>({ capabilities: ['inbound', 'outbound'], createAdapter: () => new TerminalAdapter() });

function isTerminal(stream: Readable | Writable): boolean {
  return (stream as Readable & { readonly isTTY?: boolean }).isTTY === true;
}
function formatPayload(payload: unknown): string { return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2); }
function formatError(error: unknown): string { return error instanceof Error ? error.stack ?? error.message : String(error); }
