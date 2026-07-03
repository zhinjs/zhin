import { createServer } from 'node:http';

export async function canListenOnLocalhost(): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(0, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

export function skipIfNoLocalhostListen(ctx: { skip: () => void }, canListen: boolean): boolean {
  if (canListen) return false;
  ctx.skip();
  return true;
}
