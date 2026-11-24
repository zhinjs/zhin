import { createEndpointSpecification, endpointSpec, type Endpoint } from 'zhin.js/adapter';
import { EmailClient, type EmailEndpointOptions } from './client.js';
export type { EmailEndpointOptions } from './client.js';

/** Actual protocol Client; framework lifecycle and admission stay in their symbol namespace. */
export class EmailEndpoint extends EmailClient implements Endpoint {
  readonly [endpointSpec] = this.#createSpecification();
  constructor(options: EmailEndpointOptions) { super(options); }
  #createSpecification() {
    const hooks = {
      start: (signal: AbortSignal) => this.#startFramework(signal),
      open: () => this.openInput(), close: () => this.closeInput(), stop: () => this.disconnectTransport(),
      send: (request: import('zhin.js/adapter').EndpointSendRequest) => this.sendPayload(request),
      name: this.configName(),
      inboundMedia: this.endpointInboundMedia,
    };
    Object.defineProperty(hooks, 'transportState', { get: () => this.transportState });
    return createEndpointSpecification(this, hooks);
  }
  #startFramework(signal: AbortSignal) { return this.connectTransport(signal); }
  protected override inboundReceiptCurrent(current: () => boolean): boolean { return current(); }
  /** Settles with the callback, not with the dispatch it handed off (#1250 adapter-inbound-deadlock). */
  protected override receiveInboundCallback<T>(receive: () => T | Promise<T>): Promise<T> {
    return this[endpointSpec].events.admit(receive);
  }
  protected override publishEvent(name: string, payload: unknown): Promise<unknown> {
    return this[endpointSpec].events.emit(name, payload);
  }
  protected override publishAccepted(name: string, payload: unknown): Promise<void> {
    return this[endpointSpec].events.handoff(name, payload).then(({ dispatched }) => {
      this.reportDispatch(dispatched, name);
    });
  }
  protected override async publishPlatform(name: string, event: unknown): Promise<unknown> {
    await super.publishPlatform(name, event);
    return this[endpointSpec].events.platform(name, event);
  }
}
