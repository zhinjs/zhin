// Fake Zhin instance for package-transaction tests: refuses to start while `node_modules/broken-pkg` exists.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

if (existsSync(join(process.cwd(), 'node_modules', 'broken-pkg', 'package.json'))) {
  console.error('broken-pkg cannot be loaded');
  process.exit(1);
}
const keepAlive = setInterval(() => {}, 1_000);
process.on('message', (message) => {
  if (message?.type !== 'shutdown') return;
  clearInterval(keepAlive);
  process.disconnect?.();
});
console.log('instance ready');
process.send?.({ type: 'ready', payload: { version: 1, pid: process.pid, generation: 1 } });
