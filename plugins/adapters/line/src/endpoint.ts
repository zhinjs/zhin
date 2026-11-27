import { createEndpointSpecification, endpointSpec, type Endpoint } from 'zhin.js/adapter';
import { LineClient, type LineEndpointOptions } from './client.js';
import { createLineSelfProfile } from './self-profile.js';
export type { LineEndpointOptions } from './client.js';
export type { LineFetch } from './client.js';

/** Actual protocol Client; framework lifecycle and admission stay in their symbol namespace. */
export class LineEndpoint extends LineClient implements Endpoint {
  readonly [endpointSpec] = this.#createSpecification();
  constructor(options: LineEndpointOptions) { super(options); }
  #createSpecification() {
    const hooks = {
      start: (signal: AbortSignal) => this.#startFramework(signal),
      open: () => this.openInput(), close: () => this.closeInput(), stop: () => this.disconnectTransport(),
      send: (request: import('zhin.js/adapter').EndpointSendRequest) => this.sendPayload(request),
      name: this.configName(),
      management: this.endpointManagement,
      profile: createLineSelfProfile({ client: this, reportAccount: id => this[endpointSpec].reportSelfUserId(id) }),
    };
    Object.defineProperty(hooks, 'transportState', { get: () => this.transportState });
    return createEndpointSpecification(this, hooks);
  }
  #startFramework(signal: AbortSignal) { return this.connectTransport(signal); }
  protected override inboundReceiptCurrent(): boolean { return !this.executionSignal?.aborted; }
  /**
   * #1250 b115: the webhook response is LINE's delivery ACK. It settles with the callback (the hand-off to
   * the Runtime), not with the dispatch it started — a whole Agent turn would outlast LINE's timeout.
   */
  protected override receiveInboundCallback<T>(receive: () => T | Promise<T>): Promise<T> {
    return this[endpointSpec].events.admit(receive);
  }
  protected override publishEvent(name: string, payload: unknown): Promise<unknown> {
    return this[endpointSpec].events.emit(name, payload);
  }
  /** Resolves once the Runtime holds the event; a later dispatch failure is only logged. */
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
