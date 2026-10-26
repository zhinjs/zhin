import { CommandIndex, commandFeatureId, type CommandDefinition } from 'zhin.js/command';
import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from 'zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { isRawContent } from '@zhin.js/core/runtime';
import { buildQrImageUrl, qrImageSegment } from '../src/qrcode-lib.js';
import plugin from '../plugin.js';
import qrcodeCommand from '../commands/gen/index.js';
import scanCommand from '../commands/scan/[url]/index.js';

describe('@zhin.js/plugin-qrcode', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('qrcode');
  });

  it('builds QR image URL and segment', () => {
    const url = buildQrImageUrl('hello');
    expect(url).toContain('create-qr-code');
    expect(url).toContain(encodeURIComponent('hello'));
    expect(qrImageSegment('hello')).toEqual([
      { type: 'image', data: { url } },
    ]);
  });

  it('executes declared text and size through the real parser', async () => {
    expect(parseCommandDefinition(qrcodeCommand)).toBe(qrcodeCommand);
    expect(parseCommandDefinition(scanCommand)).toBe(scanCommand);
    const result = await commandIndex('gen', qrcodeCommand).dispatch('gen hello beautiful world --size 512');
    expect(result.status).toBe('executed');
    expect(isRawContent(result.value) && result.value.payload).toEqual({ type: 'image', data: { url: buildQrImageUrl('hello beautiful world', 512) } });
  });

  it('uses defaults and reports invalid size without creating an image', async () => {
    const index = commandIndex('gen', qrcodeCommand);
    const result = await index.dispatch('gen ping');
    expect(isRawContent(result.value) && result.value.payload).toEqual({ type: 'image', data: { url: buildQrImageUrl('ping') } });
    const invalid = await index.dispatch('gen ping -s 10');
    expect(invalid).toMatchObject({ status: 'invalid', issues: [{ field: '--size' }] });
    expect(invalid.value).toBeUndefined();
    const help = await index.dispatch('gen --help', undefined, undefined, '#');
    expect(String(help.value)).toContain('#gen <text> [--size <integer>]');
    expect(String(help.value)).toContain('默认值：300');
  });

  it('shows scan help before issuing a decode HTTP request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      for (const options of [undefined, {}]) {
        const index = commandIndex('scan/$url', { ...scanCommand, options, $parameter: { name: 'url', type: 'string' } });
        for (const input of ['scan --help', 'scan --help https://example.org', 'scan https://example.org --help']) {
          await expect(index.dispatch(input)).resolves.toMatchObject({ status: 'executed', value: expect.stringContaining('scan <url>') });
        }
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([0, -1, 300.5, 1025, NaN, Infinity, '300&size=1'])('rejects invalid QR helper size %s', (size) => {
    expect(() => buildQrImageUrl('hello', size as number)).toThrow('integer between 64 and 1024');
  });
});

function commandIndex(localName: string, definition: CommandDefinition) {
  const owner = rootPluginId();
  const slot = createCapabilitySlot({ owner, feature: commandFeatureId, localName, source: `/commands/${localName}/index.ts`, definition });
  const snapshot = { generation: 1, root: owner,
    tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: '@test/plugin', packageRoot: '/test', children: [] }]]),
    config: new Map([[owner, {}]]), resources: new Map([[owner, new Map()]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  } satisfies RuntimeSnapshot;
  return new CommandIndex([slot], snapshot);
}
