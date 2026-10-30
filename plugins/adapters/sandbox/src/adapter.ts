import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { projectLocaleToken, resolveLocale } from 'zhin.js/i18n';
import { resolveSandboxEndpoint, type SandboxEndpointConfig } from './protocol.js';
import { SandboxWsEndpoint } from './endpoint.js';
import type { SandboxClientEventMap } from './client.js';

export class SandboxAdapter extends Adapter<SandboxWsEndpoint, SandboxEndpointConfig, SandboxClientEventMap> {
  readonly #context: AdapterContext<SandboxEndpointConfig>;
  constructor(context: AdapterContext<SandboxEndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  // owner binds the synthetic sender's existing permissions and is not a runtime connection setting.
  override get configurationUpdateFields(): readonly string[] { return []; }
  protected override validateConfiguration(config: SandboxEndpointConfig): void { resolveSandboxEndpoint(config); }
  protected createEndpoint(input: SandboxEndpointConfig, execution: EndpointCreationContext): SandboxWsEndpoint {
    return new SandboxWsEndpoint({ id: execution.canonicalId, defaults: resolveSandboxEndpoint(input),
      http: this.#context.use(httpHostToken), locale: resolveLocale(this.#context.use(projectLocaleToken)) });
  }
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly sandbox: SandboxAdapter; }
}
