import net from 'node:net';

/** What holds a port the new project would listen on (#1250 scaffold-port-collision). */
export type PortOccupant = 'zhin-gateway' | 'other';

export interface PortProbe {
  /** True when nothing listens on `port` (a listener on 127.0.0.1 can be opened). */
  free(port: number): Promise<boolean>;
  /** Who answers on an occupied port: a Zhin gateway reports `/pub/health`. */
  occupant(port: number): Promise<PortOccupant>;
}

function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      // Only "address in use" means occupied; e.g. an unavailable IPv6 stack does not.
      resolve(error.code !== 'EADDRINUSE' && error.code !== 'EACCES');
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** `GET /pub/health` of a Zhin gateway answers `{ success: true, status: 'ok', instance: … }`. */
async function answersAsZhinGateway(port: number, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/pub/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const body = await response.json() as { status?: unknown; instance?: unknown };
    return body.status === 'ok' && typeof body.instance === 'object' && body.instance !== null;
  } catch {
    return false;
  }
}

export const defaultPortProbe: PortProbe = {
  async free(port) {
    // The gateway binds 127.0.0.1 by default; 0.0.0.0 catches a project that listens on all interfaces.
    return await canListen(port, '127.0.0.1') && await canListen(port, '0.0.0.0');
  },
  occupant: async (port) => (await answersAsZhinGateway(port, 1_000) ? 'zhin-gateway' : 'other'),
};

export interface PortChoice {
  readonly port: number;
  /** Set when `preferred` was taken and another port was chosen. */
  readonly collision?: Readonly<{ port: number; occupant: PortOccupant }>;
}

/**
 * The HTTP port for a new project: `preferred` when it is free, else the next free port above it
 * (up to `attempts` ports). When none is free the preferred port is kept (with `collision` set),
 * so creating the project never fails on this check.
 */
export async function chooseHttpPort(preferred: number, probe: PortProbe = defaultPortProbe, attempts = 20): Promise<PortChoice> {
  if (await probe.free(preferred)) return { port: preferred };
  const occupant = await probe.occupant(preferred);
  for (let port = preferred + 1; port < preferred + 1 + attempts && port <= 65535; port++) {
    if (await probe.free(port)) return { port, collision: { port: preferred, occupant } };
  }
  return { port: preferred, collision: { port: preferred, occupant } };
}

/** The notice for a changed (or kept, occupied) port; undefined when the preferred port was free. */
export function describePortChoice(choice: PortChoice, text: (key: string, values: readonly unknown[]) => string): string | undefined {
  if (!choice.collision) return undefined;
  if (choice.port === choice.collision.port) return text('create.port.noneFree', [choice.port]);
  const key = choice.collision.occupant === 'zhin-gateway' ? 'create.port.zhinGateway' : 'create.port.other';
  return text(key, [choice.collision.port, choice.port]);
}
