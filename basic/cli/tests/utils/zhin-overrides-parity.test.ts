/**
 * #1250 update-overrides-not-synced: the dry-run's copy of the override classification and
 * messages (`src/utils/zhin-overrides.ts`) must say exactly what the gateway's update does.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as cli from '../../src/utils/zhin-overrides.js';
import * as gateway from '../../../../packages/host/gateway/src/plugin-management/zhin-overrides.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-overrides-parity-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const CASES: readonly [string, unknown][] = [
  ['zhin.js', '1.6.0'], ['@zhin.js/core', '^1.11.0'], ['@zhin.js/core', '~1.11.0'], ['@zhin.js/core', '=v1.11.0'],
  ['zhin.js>@zhin.js/core', '1.11.0'], ['@zhin.js/plugin-foo>zhin.js', '1.6.0'],
  ['@types/node', '22.0.0'], ['zhin.js>@types/node', '1.0.0'], ['zhin.js', 'link:../zhin'], ['zhin.js', '$zhin.js'],
  ['@zhin.js/core', 'workspace:*'], ['@zhin.js/core', '-'], ['@zhin.js/core@<1.12', '1.11.0'], ['zhin.js@1>@zhin.js/core', '1.11.0'],
  ['a>zhin.js>@zhin.js/core', '1.11.0'], ['@zhin.js/core', '>=1.11 <1.12'], ['@zhin.js/core', { '@zhin.js/kernel': '1.3.0' }],
];

describe('dry-run and gateway agree on pnpm overrides', () => {
  it.each(CASES)('classifies %s: %j the same way', (key, value) => {
    expect(cli.classifyZhinOverride(key, value)).toEqual(gateway.classifyZhinOverride(key, value));
  });

  it('reads the same entries, lines and messages from both files', () => {
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'bot', pnpm: { overrides: Object.fromEntries(CASES.filter(([key]) => !key.startsWith('zhin.js>')).map(([key, value]) => [key, value])) } }, null, 2)}\n`);
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "overrides:\n  zhin.js: 1.6.0\n  'zhin.js>@zhin.js/core': ~1.11.0\n  left: 1.0.0\n");
    const fromCli = cli.readZhinOverrides(root);
    const fromGateway = gateway.readZhinOverrides(root);
    expect(fromCli).toEqual(fromGateway);
    expect(fromCli.entries.map(cli.manualOverrideHint)).toEqual(fromGateway.entries.map(gateway.manualOverrideHint));
    expect(fromCli.entries.map(entry => cli.syncedOverrideValue(entry, '2.0.0'))).toEqual(fromGateway.entries.map(entry => gateway.syncedOverrideValue(entry, '2.0.0')));
    const changes = [{ file: 'pnpm-workspace.yaml' as const, key: 'zhin.js', from: '1.6.0', to: '1.7.0' }];
    expect(cli.formatOverrideChanges(changes)).toEqual(gateway.formatOverrideChanges(changes));
  });

  it('keeps the shared part of both modules textually identical', () => {
    const shared = (file: string) => {
      const text = fs.readFileSync(file, 'utf8');
      return [
        text.slice(text.indexOf('export type ZhinOverrideFile'), text.indexOf('interface Manifest {') >= 0 ? text.indexOf('interface Manifest {') : text.indexOf('export interface ZhinOverrideChange')),
        text.slice(text.indexOf('export interface ZhinOverrideChange'), text.indexOf('export interface ZhinOverrideSyncResult') >= 0 ? text.indexOf('export interface ZhinOverrideSyncResult') : text.indexOf('/** Readable lines of a sync')),
        text.slice(text.indexOf('/** Readable lines of a sync')),
      ];
    };
    expect(shared(path.resolve(import.meta.dirname, '../../src/utils/zhin-overrides.ts')))
      .toEqual(shared(path.resolve(import.meta.dirname, '../../../../packages/host/gateway/src/plugin-management/zhin-overrides.ts')));
  });
});
