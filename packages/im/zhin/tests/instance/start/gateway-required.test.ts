import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INSTANCE_CHILD_ENV } from '@zhin.js/host-http/bridge';
import { InstanceGatewayRequiredError, runStartCommand } from '../../../src/instance/start-command.js';

const directories: string[] = [];
const savedMarker = process.env[INSTANCE_CHILD_ENV];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  if (savedMarker === undefined) delete process.env[INSTANCE_CHILD_ENV];
  else process.env[INSTANCE_CHILD_ENV] = savedMarker;
});

function project(): string {
  const directory = mkdtempSync(join(tmpdir(), 'zhin-gateway-required-'));
  directories.push(directory);
  writeFileSync(join(directory, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'demo', type: 'module' }));
  return directory;
}

describe('instance start without the gateway (ADR 0054 §3)', () => {
  it('refuses to start without a control channel unless standalone HTTP is requested', async () => {
    delete process.env[INSTANCE_CHILD_ENV];
    const failure = await runStartCommand({
      root: project(), args: ['--once', '--no-watch'], writeOutput: () => undefined, writeError: () => undefined,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InstanceGatewayRequiredError);
    expect((failure as InstanceGatewayRequiredError).code).toBe('ZHIN_INSTANCE_GATEWAY_REQUIRED');
    expect((failure as Error).message).toContain('zhin start');
    expect((failure as Error).message).toContain('--standalone');
  });
});
