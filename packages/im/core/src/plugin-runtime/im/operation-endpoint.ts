import type { EndpointChildLease } from '@zhin.js/adapter';

/** Internal send binding retained by one inbound operation; never a wire/config field. */
export const operationEndpoint = Symbol('zhin.im.operation-endpoint');
export interface OperationEndpointSource {
  readonly [operationEndpoint]?: EndpointChildLease;
}
