import { createEndpointSpecification, endpointSpec, type Endpoint } from 'zhin.js/adapter';
import { DingTalkClient, type DingTalkEndpointOptions } from './client.js';
export type { DingTalkEndpointOptions } from './client.js';
export type { DingTalkFetch } from './client.js';

/** Actual protocol Client; framework lifecycle and admission stay in their symbol namespace. */
export class DingTalkEndpoint extends DingTalkClient implements Endpoint {
  readonly [endpointSpec] = this.#createSpecification();
  constructor(options: DingTalkEndpointOptions) { super(options); }
  #createSpecification() {
    const hooks = {
      start: (signal: AbortSignal) => this.#startFramework(signal),
      open: () => this.openInput(), close: () => this.closeInput(), stop: () => this.disconnectTransport(),
      send: (request: import('zhin.js/adapter').EndpointSendRequest) => this.sendPayload(request),
      name: this.configName(),
    };
    Object.defineProperty(hooks, 'transportState', { get: () => this.transportState });
    return createEndpointSpecification(this, hooks);
  }
  #startFramework(signal: AbortSignal) { return this.connectTransport(signal); }
  /**
   * #1250 b115: the webhook 200 and the Stream ACK settle with the callback (the hand-off to the Runtime),
   * not with the dispatch it started — a whole Agent turn would outlast DingTalk's timeout and cause a retry.
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
