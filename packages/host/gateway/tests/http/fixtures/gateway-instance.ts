// Instance for the CLI-supervised gateway test: run as `<entry> runtime start …` by
// runGateway, serves its routes over the control channel only (no listener of its own).
// Console accounts live in the gateway (B1.4): this instance only sees forwarded principals.
import { createBridgedHttpHost, openInstanceControlChannel } from '@zhin.js/host-http/bridge';

const channel = openInstanceControlChannel();
if (!channel) throw new Error('expected a gateway control channel');
const host = createBridgedHttpHost({ channel });
// Reported to the gateway with the route table (`catalog`).
host.tokenRegistry.usePluginPermissions(() => [{ id: 'fixture:read', level: 'read', declared: true, owners: ['root/fixture'] }]);
host.route('GET', '/hello', () => Response.json({ hello: 'instance', pid: process.pid, origin: host.address?.origin ?? null }));
host.route('POST', '/api/console/request', async (request, context) => {
  const forwarded = await request.json() as { type?: string };
  // Instance-side audit entries go to the gateway's audit log.
  if (forwarded.type === 'system:audit') host.tokenRegistry.accessProvider?.audit?.({ actor: 'instance', action: 'rpc:system:audit', outcome: 'ok' });
  return Response.json({ forwarded, principal: context.principal ?? null });
});
// A Console SSE stream; `principal-revoked` must end it.
host.route('GET', '/api/events', (_request, context) => {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const user = context.principal && context.principal.kind !== 'bootstrap' ? context.principal.username : null;
      controller.enqueue(encoder.encode(`id: 1\nevent: hello\ndata: ${JSON.stringify({ user })}\n\n`));
      timer = setInterval(() => controller.enqueue(encoder.encode(': keepalive\n\n')), 200);
    },
    cancel() { clearInterval(timer); },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
});
host.route('POST', '/exit', () => {
  setTimeout(() => { void host.close().then(() => { channel.close(); process.exit(0); }); }, 10);
  return new Response(null, { status: 202 });
});
channel.onShutdown(() => {
  void host.close().then(() => { channel.close(); process.disconnect?.(); });
});
await host.listen();
channel.ready({ generation: 1, routes: host.routeTable() });
