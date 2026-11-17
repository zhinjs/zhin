import { createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSendRequest } from 'zhin.js/adapter';
import { IpadWechatClient, type IpadWechatEndpointOptions } from './client.js';

/** The actual protocol Client; framework lifecycle and admission stay in their symbol namespace. */
export class IpadWechatEndpoint extends IpadWechatClient implements Endpoint {
  readonly [endpointSpec] = this.#createSpecification();

  constructor(options: IpadWechatEndpointOptions) { super(options); }

  #createSpecification() {
    const hooks = {
      start: (signal: AbortSignal) => this.connectTransport(signal),
      open: () => this.openInput(),
      close: () => this.closeInput(),
      stop: () => this.disconnectTransport(),
      send: (request: EndpointSendRequest) => this.sendPayload(request),
      name: this.configName(),
      management: this.endpointManagement,
    };
    Object.defineProperty(hooks, 'transportState', { get: () => this.transportState, enumerable: true });
    return createEndpointSpecification(this, hooks);
  }

  protected override receiveInboundCallback<T>(receive: () => T | Promise<T>): Promise<T> {
    return this[endpointSpec].events.run(receive);
  }

  protected override publishAccepted(name: string, payload: unknown): Promise<unknown> {
    return this[endpointSpec].events.emitAccepted(name, payload);
  }

  protected override async publishPlatform(name: string, event: unknown): Promise<unknown> {
    await super.publishPlatform(name, event);
    return this[endpointSpec].events.platform(name, event);
  }

  protected override inboundConversation(conversation: Readonly<{ kind: 'private' | 'group'; id: string }>): unknown {
    return Object.freeze({ ...conversation, endpoint: this[endpointSpec].identity });
  }

  protected override reportSelf(account: string | null): void {
    if (account) this[endpointSpec].reportSelfUserId(account);
  }
}
