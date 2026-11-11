// Instance for the long-lived gateway tests: logs a line, can crash on start (FAKE_CRASH=1)
// or on request (POST /crash), and stops on the gateway's `shutdown`.
import { createBridgedHttpHost, openInstanceControlChannel } from '@zhin.js/host-http/bridge';

console.log(`fake instance up ${process.pid}`);
if (process.env.FAKE_CRASH === '1') {
  console.error('fake instance crashing');
  process.exit(1);
}
const channel = openInstanceControlChannel();
if (!channel) throw new Error('expected a gateway control channel');
const host = createBridgedHttpHost({ channel });
host.route('GET', '/hello', () => Response.json({ hello: 'instance', pid: process.pid }));
host.route('POST', '/crash', () => {
  setTimeout(() => { process.exit(3); }, 10);
  return new Response(null, { status: 202 });
});
channel.onShutdown(() => {
  console.log('fake instance stopping');
  void host.close().then(() => { channel.close(); process.disconnect?.(); });
});
await host.listen();
channel.ready({ generation: 1, routes: host.routeTable() });
