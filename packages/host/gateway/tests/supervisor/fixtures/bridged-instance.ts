// Bridged instance for InstanceSupervisor tests: serves HTTP / WS routes through the control channel only.
import { createBridgedHttpHost, openInstanceControlChannel } from '@zhin.js/host-http/bridge';

const channel = openInstanceControlChannel();
if (!channel) throw new Error('expected a gateway control channel');
const host = createBridgedHttpHost({ channel });
// No timers or servers: the listening bridge alone must keep this process alive.
let version = process.env.FAKE_ROUTE_VERSION ?? '1';
host.route('GET', '/hello', () => new Response(`hello v${version} from ${process.pid}`));
host.route('POST', '/upload', async (request) => new Response(String((await request.arrayBuffer()).byteLength)));
host.route('POST', '/reload', () => {
  // A "hot reload": a new route appears in the table.
  version = '2';
  host.route('GET', '/v2', () => new Response('v2'));
  return new Response(null, { status: 204 });
});
host.ws('/echo', { auth: 'protocol' }).onConnection((connection) => {
  connection.onMessage((data) => connection.send(data));
});
channel.onShutdown(() => {
  void host.close().then(() => { channel.close(); process.disconnect?.(); });
});
await host.listen();
channel.ready({ generation: 1, routes: host.routeTable() });
