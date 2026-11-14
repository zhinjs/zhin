import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { CommandIndex, CommandPathSyntaxError, bindCommandSource, commandFeatureId, type CommandDefinition } from 'zhin.js/command';
import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from 'zhin.js/plugin-runtime';
import { nettoolsServiceToken } from '../src/runtime.js';
import type { NettoolsService } from '../src/service.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function commandFiles(directory = join(packageRoot, 'commands')): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? commandFiles(join(directory, entry.name))
    : entry.name === 'index.ts' ? [join(directory, entry.name)] : []);
}

function commandIndex(localName: string, definition: CommandDefinition, service: NettoolsService) {
  const owner = rootPluginId();
  const slot = createCapabilitySlot({ owner, feature: commandFeatureId, localName, source: `/commands/${localName}/index.ts`, definition });
  const snapshot = { generation: 1, root: owner,
    tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: '@zhin.js/plugin-nettools', packageRoot: '/test', children: [] }]]),
    config: new Map([[owner, {}]]), resources: new Map([[owner, new Map<unknown, unknown>([[nettoolsServiceToken.id, service]])]]),
    capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  } as unknown as RuntimeSnapshot;
  return new CommandIndex([slot], snapshot);
}

describe('nettools command directories (#1250)', () => {
  it('every command file loads with the runtime path rules (one trailing parameter directory)', async () => {
    const files = commandFiles();
    expect(files.map(file => relative(packageRoot, file).replaceAll('\\', '/')).sort()).toEqual([
      'commands/dns/[name]/index.ts', 'commands/domain-price/[suffix]/index.ts',
      'commands/ping/[host]/index.ts', 'commands/whois/[domain]/index.ts',
    ]);
    for (const file of files) {
      const definition = (await import(file)).default as CommandDefinition;
      expect(() => bindCommandSource(definition, file), file).not.toThrow();
    }
  });

  it('the former two-level parameter directories were rejected by the loader', async () => {
    const dns = (await import('../commands/dns/[name]/index.ts')).default as CommandDefinition;
    expect(() => bindCommandSource(dns, join(packageRoot, 'commands/dns/[name]/[[type]]/index.ts'))).toThrow(CommandPathSyntaxError);
  });

  it('keeps `dns <name> [type]` and `domain-price <suffix> [order]` working', async () => {
    const service = { run: vi.fn(async (operation: () => Promise<string>) => operation()),
      dns: vi.fn(async () => 'dns'), domainPrice: vi.fn(async () => 'price') } as unknown as NettoolsService;
    for (const [file, name] of [['commands/dns/[name]/index.ts', 'dns'], ['commands/domain-price/[suffix]/index.ts', 'domain-price']] as const) {
      const definition = (await import(`../${file}`)).default as CommandDefinition;
      const bound = bindCommandSource(definition, join(packageRoot, file));
      const index = commandIndex(bound.localName, bound.definition, service);
      if (name === 'dns') {
        await expect(index.dispatch({ input: 'dns example.com MX' })).resolves.toMatchObject({ status: 'executed', value: 'dns' });
        await expect(index.dispatch({ input: 'dns example.com' })).resolves.toMatchObject({ status: 'executed' });
      } else {
        await expect(index.dispatch({ input: 'domain-price com renew' })).resolves.toMatchObject({ status: 'executed', value: 'price' });
        await expect(index.dispatch({ input: 'domain-price .cn' })).resolves.toMatchObject({ status: 'executed' });
      }
    }
    expect((service.dns as ReturnType<typeof vi.fn>).mock.calls.map(call => call.slice(0, 2))).toEqual([['example.com', 'MX'], ['example.com', undefined]]);
    expect((service.domainPrice as ReturnType<typeof vi.fn>).mock.calls.map(call => call.slice(0, 2))).toEqual([['com', 'renew'], ['.cn', undefined]]);
  });
});
