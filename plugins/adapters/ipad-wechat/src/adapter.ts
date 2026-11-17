import path from 'node:path';
import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { loginAssistToken } from '@zhin.js/core/runtime';
import { IpadWechatEndpoint } from './endpoint.js';
import { resolveIpadWechatConfig, type IpadWechatEndpointConfig } from './protocol.js';
import type { IpadSdk } from './sdk.js';

export interface IpadWechatAdapterOptions {
  /** Test / embedding: the SDK module instead of importing `@wchats/ipad`. */
  readonly sdk?: IpadSdk | (() => Promise<IpadSdk>);
}

/** Account construction and actual SDK ownership belong to this Adapter. */
export class IpadWechatAdapter extends Adapter<IpadWechatEndpoint, IpadWechatEndpointConfig> {
  readonly #context?: AdapterContext<IpadWechatEndpointConfig>;
  readonly #options: IpadWechatAdapterOptions;

  constructor(context?: AdapterContext<IpadWechatEndpointConfig>, options: IpadWechatAdapterOptions = {}) {
    super();
    this.#context = context;
    this.#options = options;
  }

  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationUpdateFields(): readonly string[] {
    return ['dataDir', 'loginTimeoutMs', 'qrPollIntervalMs', 'heartbeatIntervalSeconds', 'reconnect',
      'ignoreSelfMessages', 'downloadImages', 'verification'];
  }
  override get configurationIdentityProbeFields(): readonly string[] { return ['dataDir']; }

  /** One SDK state directory per account: the SDK forbids sharing a dataDir. */
  protected override prepareConfiguration(input: IpadWechatEndpointConfig, identity: Readonly<{ instanceId: string }>): IpadWechatEndpointConfig {
    const config = resolveIpadWechatConfig(input);
    return { ...input, dataDir: path.join(config.dataDir, 'accounts', identity.instanceId) };
  }

  protected override validateConfiguration(config: IpadWechatEndpointConfig): void { resolveIpadWechatConfig(config); }

  protected createEndpoint(input: IpadWechatEndpointConfig, execution: EndpointCreationContext): IpadWechatEndpoint {
    const context = this.#context;
    const loginAssist = context?.has?.(loginAssistToken) ? context.use(loginAssistToken) : undefined;
    return new IpadWechatEndpoint({
      id: execution.canonicalId,
      config: resolveIpadWechatConfig(input),
      signal: execution.signal,
      endpointIdentity: { canonicalId: execution.canonicalId, instanceId: execution.instanceId, epoch: execution.epoch, incarnationId: execution.incarnationId },
      ...(loginAssist ? { loginAssist } : {}),
      ...(this.#options.sdk ? { sdk: this.#options.sdk } : {}),
    });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'ipad-wechat': IpadWechatAdapter }
}
