import {
  bindGenerationAdmission,
  generationAdmissionBinder,
  type GenerationAdmissionBindable,
  type GenerationAdmissionGate,
} from '@zhin.js/plugin-runtime';
import {
  createHttpHost,
  type HttpHost,
  type HttpHostAddress,
  type HttpHostOptions,
  type HttpRouteRegistration,
  type ProcessHttpHost,
  type WsHandle,
  type WsRouteOptions,
} from './http-host.js';

const addressProvider = Symbol('HttpHostAddressProvider');

interface AddressAwareHttpHost {
  readonly [addressProvider]: () => readonly HttpHostAddress[];
}

type BoundHttpHost = HttpHost & GenerationAdmissionBindable<HttpHost> & AddressAwareHttpHost;

/**
 * Runs one logical Host surface on multiple network listeners. Route and WS
 * registration stays generation-owned and is mirrored to every listener,
 * while `address` intentionally remains the primary/local listener.
 */
export function createHttpHostGroup(
  options: readonly HttpHostOptions[],
): ProcessHttpHost {
  if (options.length === 0) throw new Error('HttpHostGroup requires at least one listener');
  const listeners = options.map((entry) => createHttpHost(entry));

  const createSurface = (hosts: readonly HttpHost[]): BoundHttpHost => {
    const primary = hosts[0]!;
    const surface: BoundHttpHost = {
      [generationAdmissionBinder](admission: GenerationAdmissionGate): HttpHost {
        return createSurface(hosts.map((host) => bindGenerationAdmission(host, admission)));
      },
      [addressProvider]: () => listeners.flatMap((host) => host.address ? [host.address] : []),
      ws(path: string, wsOptions?: WsRouteOptions): WsHandle {
        const handles = hosts.map((host) => host.ws(path, wsOptions));
        return {
          onConnection(listener) {
            const disposers = handles.map((handle) => handle.onConnection(listener));
            return () => { for (const dispose of disposers.reverse()) dispose(); };
          },
          close() { for (const handle of handles) handle.close(); },
        };
      },
      route(method, path, handler, meta): HttpRouteRegistration {
        const disposers = hosts.map((host) => host.route(method, path, handler, meta));
        return () => { for (const dispose of disposers.reverse()) dispose(); };
      },
      listRoutes: () => primary.listRoutes(),
      get address() { return primary.address; },
      get tokenRegistry() { return primary.tokenRegistry; },
    };
    return Object.freeze(surface);
  };

  const surface = createSurface(listeners);
  let closeResult: Promise<void> | undefined;
  const runtime: ProcessHttpHost & AddressAwareHttpHost = {
    [generationAdmissionBinder](admission: GenerationAdmissionGate): HttpHost {
      return surface[generationAdmissionBinder](admission);
    },
    [addressProvider]: surface[addressProvider],
    ws: (path, wsOptions) => surface.ws(path, wsOptions),
    route: (method, path, handler, meta) => surface.route(method, path, handler, meta),
    listRoutes: () => surface.listRoutes(),
    get address() { return surface.address; },
    get tokenRegistry() { return surface.tokenRegistry; },
    async listen(): Promise<HttpHostAddress> {
      try {
        for (const listener of listeners) {
          await listener.listen();
        }
      } catch (error) {
        await Promise.allSettled([...listeners].reverse().map((listener) => listener.close()));
        throw error;
      }
      return listeners[0]!.address!;
    },
    close(): Promise<void> {
      closeResult ??= closeListeners(listeners);
      return closeResult;
    },
  };
  return Object.freeze(runtime);
}

/** Returns every bound listener, ordered primary/local first. */
export function listHttpHostAddresses(host: HttpHost): readonly HttpHostAddress[] {
  const provider = (host as Partial<AddressAwareHttpHost>)[addressProvider];
  if (typeof provider === 'function') return Object.freeze([...provider.call(host)]);
  return Object.freeze(host.address ? [host.address] : []);
}

async function closeListeners(listeners: readonly ProcessHttpHost[]): Promise<void> {
  const results = await Promise.allSettled([...listeners].reverse().map((listener) => listener.close()));
  const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'multiple HTTP listeners failed to close');
}
