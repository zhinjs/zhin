import { createEndpointSpecification, endpointSpec, type Endpoint } from 'zhin.js/adapter';
import { LarkClient, type LarkEndpointOptions } from './client.js';
export type { LarkEndpointOptions } from './client.js';
export type { LarkFetch } from './client.js';

/** Actual protocol Client; framework lifecycle and admission stay in their symbol namespace. */
export class LarkEndpoint extends LarkClient implements Endpoint {
  readonly [endpointSpec] = this.#createSpecification();
  constructor(options: LarkEndpointOptions) { super(options); }
  #createSpecification() {
    const hooks = {
      start: (signal: AbortSignal) => this.#startFramework(signal),
      open: () => this.openInput(), close: () => this.closeInput(), stop: () => this.disconnectTransport(),
      send: (request: import('zhin.js/adapter').EndpointSendRequest) => this.sendPayload(request),
      name: this.configName(),
      control: this.endpointControl,
      management: this.endpointManagement,
    };
    Object.defineProperty(hooks, 'transportState', { get: () => this.transportState });
    return createEndpointSpecification(this, hooks);
  }
  #startFramework(signal: AbortSignal) { return this.connectTransport(signal); }
  protected override receiveInboundCallback<T>(receive: () => T | Promise<T>): Promise<T> {
    return this[endpointSpec].events.run(receive);
  }
  protected override publishEvent(name: string, payload: unknown): Promise<unknown> {
    return this[endpointSpec].events.emit(name, payload);
  }
  protected override publishAccepted(name: string, payload: unknown): Promise<void> {
    return this[endpointSpec].events.emitAccepted(name, payload).then(() => undefined);
  }
  protected override async publishPlatform(name: string, event: unknown): Promise<unknown> {
    await super.publishPlatform(name, event);
    return this[endpointSpec].events.platform(name, event);
  }
}
