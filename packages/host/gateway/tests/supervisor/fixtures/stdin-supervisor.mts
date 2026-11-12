// Runs an InstanceSupervisor over fake-instance.mjs with the given `input` mode and prints the
// instance's log lines, so a test can feed this process's stdin and see what the instance read.
import { fileURLToPath } from 'node:url';
import { InstanceSupervisor } from '../../../src/supervisor/instance-supervisor.js';

const input = process.argv[2] === 'inherit' ? 'inherit' : 'ignore';
const supervisor = new InstanceSupervisor({
  spawn: {
    command: process.execPath,
    args: [fileURLToPath(new URL('./fake-instance.mjs', import.meta.url))],
    cwd: process.cwd(),
    env: { ...process.env, FAKE_ECHO_STDIN: '1' },
  },
  input,
  readyTimeoutMs: 5_000,
  shutdownBudgetMs: 300,
  killGraceMs: 300,
  restart: { onCrash: false },
});
supervisor.on('log', (line) => {
  process.stdout.write(`${line.line}\n`);
  if (line.line.startsWith('stdin')) void supervisor.stop({ force: true }).then(() => { supervisor.dispose(); process.exit(0); });
});
await supervisor.start();
