// Fake Zhin instance for InstanceSupervisor tests; behaviour is driven by FAKE_* environment variables.
import { appendFileSync, readFileSync } from 'node:fs';

const env = process.env;
const number = (name) => (env[name] === undefined ? undefined : Number(env[name]));
const send = (type, payload) => process.send?.({ type, payload });

if (env.FAKE_COUNTER_FILE) appendFileSync(env.FAKE_COUNTER_FILE, `${process.pid}\n`);
if (env.FAKE_CHILD_MARKER) console.log(`marker=${env[env.FAKE_CHILD_MARKER] ?? ''}`);
const keepAlive = setInterval(() => {}, 1_000);

for (let index = 0; index < (number('FAKE_LOG_LINES') ?? 0); index += 1) {
  process.stdout.write(`out ${index}\n`);
  process.stderr.write(`err ${index}\n`);
}

if (env.FAKE_IGNORE_SIGTERM) process.on('SIGTERM', () => { console.log('sigterm-ignored'); });
process.on('message', (message) => {
  if (message?.type !== 'shutdown') return;
  console.log(`shutdown ${message.payload.reason} ${message.payload.budgetMs}`);
  if (env.FAKE_IGNORE_SHUTDOWN) return;
  if (env.FAKE_PARTIAL) process.stdout.write(env.FAKE_PARTIAL);
  clearInterval(keepAlive);
  process.disconnect?.();
});

const crashAfter = number('FAKE_CRASH_AFTER_MS');
if (crashAfter !== undefined) setTimeout(() => { console.error('crashing'); process.exit(Number(env.FAKE_CRASH_CODE ?? 1)); }, crashAfter);

if (!env.FAKE_NO_READY) {
  setTimeout(() => {
    send('ready', { version: number('FAKE_VERSION') ?? 1, pid: process.pid, generation: 1 });
    const restartAfter = number('FAKE_RESTART_AFTER_MS');
    const starts = env.FAKE_COUNTER_FILE ? readFileSync(env.FAKE_COUNTER_FILE, 'utf8').trim().split('\n').length : 1;
    const restartLimit = number('FAKE_RESTART_TIMES') ?? 1;
    if (restartAfter !== undefined && starts <= restartLimit) setTimeout(() => send('restart-request', { reason: 'test' }), restartAfter);
    if (env.FAKE_EXIT_AFTER_READY) { clearInterval(keepAlive); process.disconnect?.(); }
  }, number('FAKE_READY_DELAY_MS') ?? 0);
}
