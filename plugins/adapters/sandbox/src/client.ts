import type { SandboxWsSocket } from './protocol.js';
import { defineEndpointClient } from 'zhin.js/adapter';

export interface SandboxClientConnection {
  readonly target: string;
  readonly owner: string;
  readonly socket: SandboxWsSocket;
  readonly placeholder: boolean;
}

/** Direct view of the live Sandbox protocol clients owned by one Endpoint. */
export class SandboxClient {
  constructor(
    private readonly resolvePath: () => string,
    private readonly resolveConnections: () => Iterable<SandboxClientConnection>,
  ) {}

  get path(): string {
    return this.resolvePath();
  }

  connections(): readonly SandboxClientConnection[] {
    return Object.freeze([...this.resolveConnections()]);
  }

  connection(target: string): SandboxClientConnection | undefined {
    return this.connections().find((connection) => connection.target === target);
  }

  send(target: string, payload: string): void {
    const connection = this.connection(target);
    if (!connection || connection.placeholder) {
      throw new Error(`Sandbox client ${target} is not connected`);
    }
    connection.socket.send(payload);
  }
}

export type SandboxClientEventMap = Record<string, unknown>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly sandbox: { readonly client: SandboxClient; readonly events: SandboxClientEventMap };
  }
}

export const sandboxClient = defineEndpointClient<SandboxClient, SandboxClientEventMap>('sandbox');
