import type { SandboxWsSocket } from './protocol.js';

export interface SandboxClientConnection {
  readonly connectionId?: string;
  readonly target: string;
  readonly owner: string;
  readonly socket: SandboxWsSocket;
  readonly placeholder?: boolean;
  /**
   * #1250 b114 L1: who opened the socket — `user:<userId>` (session or API token), `bootstrap`, or
   * null with no principal (`--standalone`). The Console's connection-scoped routes compare it with
   * the request's own principal. Undefined only on clients that do not report it.
   */
  readonly principalOwner?: string | null;
}

/** The {@link SandboxClientConnection.principalOwner} of a Console principal. */
export function sandboxPrincipalOwner(principal: { readonly kind: string; readonly userId?: string } | undefined): string | null {
  if (!principal) return null;
  if (principal.kind === 'bootstrap') return 'bootstrap';
  return (principal.kind === 'user' || principal.kind === 'api-token') && typeof principal.userId === 'string' && principal.userId
    ? `user:${principal.userId}` : `unknown:${principal.kind}`;
}

/** Direct view of the live Sandbox protocol clients owned by one Endpoint. */
export class SandboxClient<TConnection extends SandboxClientConnection = SandboxClientConnection> {
  /** Real server resources, owned here rather than resolved through an Endpoint callback. */
  protected readonly connectionRecords = new Map<string, TConnection>();
  protected wsPathValue = '/sandbox';

  get path(): string {
    return this.wsPathValue;
  }

  connections(): readonly SandboxClientConnection[] {
    return Object.freeze([...this.connectionRecords.values()].map(connection => Object.freeze({
      connectionId: connection.connectionId, target: connection.target, owner: connection.owner,
      socket: connection.socket, placeholder: connection.placeholder === true,
      ...(connection.principalOwner !== undefined ? { principalOwner: connection.principalOwner } : {}),
    })));
  }

  connection(target: string): SandboxClientConnection | undefined {
    return [...this.connections()].reverse().find((connection) => connection.target === target);
  }

  connectionById(connectionId: string): SandboxClientConnection | undefined {
    return this.connections().find((connection) => connection.connectionId === connectionId);
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
