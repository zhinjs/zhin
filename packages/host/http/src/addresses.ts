import type { HttpHost } from './http-host.js';
import type { HttpHostAddress } from './host-options.js';

/** @internal Listener groups expose every bound address through this key. */
export const httpHostAddressProvider = Symbol('HttpHostAddressProvider');

export interface AddressAwareHttpHost {
  readonly [httpHostAddressProvider]: () => readonly HttpHostAddress[];
}

/** Returns every bound listener, ordered primary/local first. */
export function listHttpHostAddresses(host: HttpHost): readonly HttpHostAddress[] {
  const provider = (host as Partial<AddressAwareHttpHost>)[httpHostAddressProvider];
  if (typeof provider === 'function') return Object.freeze([...provider.call(host)]);
  return Object.freeze(host.address ? [host.address] : []);
}
