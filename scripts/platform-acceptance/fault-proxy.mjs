/** Isolated-test forwarding proxy. Never changes system networking or logs traffic. */
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

const LOOPBACK = '127.0.0.1';

function socketHead(response) {
  const headers = Object.entries(response.headers).flatMap(([name, values]) =>
    (Array.isArray(values) ? values : [values]).map((value) => `${name}: ${value}`));
  return `HTTP/1.1 ${response.statusCode} ${response.statusMessage ?? ''}\r\n${headers.join('\r\n')}\r\n\r\n`;
}

/** upstream is a fixed origin; incoming path/query is forwarded unchanged. */
export async function createFaultProxy({ upstream, discordGateway = false, port = 18090, controlPort = 18091 }) {
  const target = new URL(upstream ?? (discordGateway ? 'wss://gateway.discord.gg/' : undefined));
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(target.protocol)
    || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('upstream must be an HTTP(S)/WS(S) origin without credentials, path or query');
  }
  for (const number of [port, controlPort]) {
    if (!Number.isInteger(number) || number < 0 || number > 65535) throw new Error('invalid listen port');
  }
  const secure = target.protocol === 'https:' || target.protocol === 'wss:';
  const requestUpstream = secure ? https.request : http.request;
  const sockets = new Set();
  const controlSockets = new Set();
  let paused = false;
  let closed = false;
  let revision = 0;
  let acceptedRequests = 0;
  let upgrades = 0;
  let cuts = 0;

  const track = (socket, owned = sockets) => {
    socket.on('error', () => { /* no payload-bearing errors leave the proxy */ });
    if (closed) { socket.destroy(); return; }
    owned.add(socket);
    socket.once('close', () => owned.delete(socket));
  };
  const status = () => ({ state: closed ? 'closed' : paused ? 'cut' : 'forwarding',
    activeSockets: sockets.size, acceptedRequests, upgrades, cuts });
  const cut = () => {
    if (closed) return status();
    paused = true;
    revision += 1;
    cuts += 1;
    for (const socket of sockets) socket.destroy();
    return status();
  };
  const recover = () => {
    if (!closed) paused = false;
    return status();
  };
  const forward = (incoming) => {
    const attempt = revision;
    let forwardingTarget = target; let forwardingPath = incoming.url;
    if (discordGateway) {
      if (!incoming.headers.upgrade || incoming.headers.upgrade.toLowerCase() !== 'websocket') throw new Error('Gateway WebSocket required');
      const local = new URL(incoming.url, 'http://127.0.0.1');
      const match = local.pathname.match(/^\/__discord_gateway\/(gateway(?:-[a-z0-9-]+)?\.discord\.gg)$/);
      if (!match) throw new Error('Invalid Gateway target');
      forwardingTarget = new URL(`wss://${match[1]}/`);
      forwardingPath = `/${local.search}`;
    }
    const forwardingSecure = forwardingTarget.protocol === 'https:' || forwardingTarget.protocol === 'wss:';
    const request = (forwardingSecure ? https.request : requestUpstream)({
      protocol: forwardingSecure ? 'https:' : 'http:', hostname: forwardingTarget.hostname,
      port: forwardingTarget.port || (forwardingSecure ? 443 : 80), method: incoming.method,
      path: forwardingPath, headers: { ...incoming.headers, host: forwardingTarget.host },
      // No global agent: every upstream socket is owned by this test proxy.
      agent: false,
    });
    request.on('socket', (socket) => {
      track(socket);
      if (closed || paused || attempt !== revision) socket.destroy();
    });
    return request;
  };
  const unavailable = (request) => closed || paused || request.socket.destroyed
    || !request.url?.startsWith('/') || request.url.startsWith('//');

  const server = http.createServer((incoming, outgoing) => {
    if (unavailable(incoming)) { incoming.socket.destroy(); return; }
    acceptedRequests += 1;
    let upstreamRequest;
    try { upstreamRequest = forward(incoming); } catch { outgoing.destroy(); return; }
    upstreamRequest.on('response', (response) => {
      response.on('error', () => outgoing.destroy());
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstreamRequest.on('error', () => outgoing.destroy());
    incoming.on('error', () => upstreamRequest.destroy());
    incoming.once('aborted', () => upstreamRequest.destroy());
    outgoing.once('close', () => upstreamRequest.destroy());
    incoming.pipe(upstreamRequest);
  });
  server.on('connection', (socket) => {
    track(socket);
    if (closed || paused) socket.destroy();
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('upgrade', (incoming, downstreamSocket, head) => {
    if (unavailable(incoming)) { downstreamSocket.destroy(); return; }
    acceptedRequests += 1;
    upgrades += 1;
    let upstreamRequest;
    try { upstreamRequest = forward(incoming); } catch { downstreamSocket.destroy(); return; }
    upstreamRequest.on('error', () => downstreamSocket.destroy());
    downstreamSocket.once('close', () => upstreamRequest.destroy());
    upstreamRequest.on('response', (response) => {
      response.on('error', () => downstreamSocket.destroy());
      if (!downstreamSocket.destroyed) downstreamSocket.write(socketHead(response));
      response.pipe(downstreamSocket);
    });
    upstreamRequest.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      if (closed || paused || downstreamSocket.destroyed) { upstreamSocket.destroy(); return; }
      downstreamSocket.write(socketHead(response));
      if (head.length) upstreamSocket.write(head);
      if (upstreamHead.length) downstreamSocket.write(upstreamHead);
      upstreamSocket.on('error', () => downstreamSocket.destroy());
      downstreamSocket.on('error', () => upstreamSocket.destroy());
      upstreamSocket.once('close', () => downstreamSocket.destroy());
      downstreamSocket.once('close', () => upstreamSocket.destroy());
      upstreamSocket.pipe(downstreamSocket);
      downstreamSocket.pipe(upstreamSocket);
    });
    upstreamRequest.end();
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
  control.on('connection', (socket) => track(socket, controlSockets));
  control.on('clientError', (_error, socket) => socket.destroy());
  const listen = (listener, listenPort) => new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(listenPort, LOOPBACK, () => {
      listener.off('error', reject);
      resolve(`http://${LOOPBACK}:${listener.address().port}`);
    });
  });
  const close = async () => {
    if (closed) return;
    closed = true;
    const closingSockets = [...sockets, ...controlSockets].map((socket) => new Promise((resolve) => {
      socket.once('close', resolve);
      socket.destroy();
    }));
    await Promise.all([...closingSockets, ...[server, control].filter((listener) => listener.listening)
      .map((listener) => new Promise((resolve) => listener.close(resolve)))]);
  };
  try {
    const origin = await listen(server, port);
    const controlOrigin = await listen(control, controlPort);
    return { origin, controlOrigin, status, cut, recover, close };
  } catch {
    await close();
    throw new Error('Could not bind fault proxy loopback listeners');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const allowed = new Set(['--upstream', '--port', '--control-port', '--discord-gateway']);
  try {
    if (args.length % 2 || args.some((value, index) => index % 2 === 0 && !allowed.has(value))) {
      throw new Error('Usage: node fault-proxy.mjs --upstream ORIGIN [--port 18090] [--control-port 18091]');
    }
    const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2], args[index * 2 + 1]]));
    if (options['--discord-gateway'] !== undefined && options['--discord-gateway'] !== 'true') throw new Error('Invalid Gateway mode');
    const proxy = await createFaultProxy({ upstream: options['--upstream'], discordGateway: options['--discord-gateway'] === 'true',
      port: options['--port'] === undefined ? 18090 : Number(options['--port']),
      controlPort: options['--control-port'] === undefined ? 18091 : Number(options['--control-port']),
    });
    // Only local listeners and counters are printable; never upstream URLs or traffic.
    process.stdout.write(`${JSON.stringify({ origin: proxy.origin, controlOrigin: proxy.controlOrigin, ...proxy.status() })}\n`);
    const stop = async () => { await proxy.close(); process.exitCode = 0; };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch {
    process.stderr.write('Fault proxy failed; check the origin and local listen ports.\n');
    process.exitCode = 1;
  }
}
