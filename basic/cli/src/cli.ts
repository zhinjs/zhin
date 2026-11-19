#!/usr/bin/env node
/**
 * `zhin` executable entry.
 *
 * The gateway supervises the Zhin instance by spawning this executable again as
 * `zhin runtime start …` with the instance-child environment (ADR 0054 §3). That process only
 * launches the project's `zhin.js/instance`; it must not load the CLI's command tree (scaffold
 * wizard, plugin tooling, preview, …) and keep it resident for the instance's lifetime (#1250).
 */
import { INSTANCE_CHILD_ENV } from '@zhin.js/host-http/bridge';

const args = process.argv.slice(2);

if (process.env[INSTANCE_CHILD_ENV] && args[0] === 'runtime' && args[1] === 'start') {
  const { runProjectInstance } = await import('./commands/runtime-instance.js');
  try {
    await runProjectInstance(args.slice(2));
  } catch (error) {
    console.error(`zhin: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} else {
  await import('./program.js');
}
