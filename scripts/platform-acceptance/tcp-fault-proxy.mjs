/** Byte-transparent, loopback-only fault injection. TLS stays end-to-end. */
import net from 'node:net';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

export async function createTcpFaultProxy({ upstreamHost, upstreamPort, port = 18465, controlPort = 18466 }) {
  if (typeof upstreamHost !== 'string' || !upstreamHost.trim() || /[\s/@?#]/.test(upstreamHost)) throw new Error('invalid upstream host');
  for (const [value, minimum] of [[upstreamPort, 1], [port, 0], [controlPort, 0]]) {
    if (!Number.isInteger(value) || value < minimum || value > 65535) throw new Error('invalid port');
  }
  const sockets = new Set();
  const controls = new Set();
  let paused = false;
  let closed = false;
  let connections = 0;
  let cuts = 0;
  const track = (socket, set) => {
    set.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => set.delete(socket));
  };
  const status = () => ({ state: closed ? 'closed' : paused ? 'cut' : 'forwarding', activeSockets: sockets.size, connections, cuts });
  const cut = () => {
    if (!closed) { paused = true; cuts += 1; for (const socket of sockets) socket.destroy(); }
    return status();
  };
  const recover = () => { if (!closed) paused = false; return status(); };
  const server = net.createServer((downstream) => {
    track(downstream, sockets);
    if (closed || paused) { downstream.destroy(); return; }
    connections += 1;
    const upstream = net.createConnection({ host: upstreamHost, port: upstreamPort });
    track(upstream, sockets);
    downstream.once('close', () => upstream.destroy());
    upstream.once('close', () => downstream.destroy());
    downstream.pipe(upstream);
    upstream.pipe(downstream);
  });
  const control = http.createServer((request, response) => {
    let result;
    if (request.method === 'GET' && request.url === '/status') result = status();
    if (request.method === 'POST' && request.url === '/cut') result = cut();
    if (request.method === 'POST' && request.url === '/recover') result = recover();
    request.resume();
    response.writeHead(result ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(result ?? { error: 'unknown control operation' }));
  });
  control.on('connection', socket => track(socket, controls));
  control.on('clientError', (_error, socket) => socket.destroy());
  let closing;
  const close = () => closing ??= (async () => {
    closed = true;
    for (const socket of [...sockets, ...controls]) socket.destroy();
    await Promise.all([server, control].filter(listener => listener.listening).map(listener => new Promise(resolve => listener.close(resolve))));
  })();
  const listen = (listener, number) => new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(number, '127.0.0.1', () => { listener.off('error', reject); resolve(listener.address().port); });
  });
  try {
    const listenPort = await listen(server, port);
    const actualControlPort = await listen(control, controlPort);
    return { host: '127.0.0.1', port: listenPort, controlOrigin: `http://127.0.0.1:${actualControlPort}`, status, cut, recover, close };
  } catch {
    await close();
    throw new Error('Could not bind TCP fault proxy loopback listeners');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const allowed = new Set(['--upstream-host', '--upstream-port', '--port', '--control-port']);
    if (args.length % 2 || args.some((value, index) => index % 2 === 0 && !allowed.has(value))) throw new Error('invalid arguments');
    const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2], args[index * 2 + 1]]));
    const proxy = await createTcpFaultProxy({ upstreamHost: options['--upstream-host'], upstreamPort: Number(options['--upstream-port']),
      port: options['--port'] === undefined ? 18465 : Number(options['--port']), controlPort: options['--control-port'] === undefined ? 18466 : Number(options['--control-port']) });
    process.stdout.write(`${JSON.stringify({ host: proxy.host, port: proxy.port, controlOrigin: proxy.controlOrigin, ...proxy.status() })}\n`);
    process.once('SIGINT', () => void proxy.close());
    process.once('SIGTERM', () => void proxy.close());
  } catch {
    process.stderr.write('TCP fault proxy failed; check fixed upstream and local ports.\n');
    process.exitCode = 1;
  }
}
