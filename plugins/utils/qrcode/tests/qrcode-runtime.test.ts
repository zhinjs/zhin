import { CommandIndex, commandFeatureId, type CommandDefinition } from 'zhin.js/command';
import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from 'zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { isRawContent } from '@zhin.js/core/runtime';
import { pluginConsoleRpcToken } from 'zhin.js';
import { generateQrCode } from 'zhin.js/qrcode';
import { buildQrDataUrl, isScannableImageUrl, qrImageSegment } from '../src/qrcode-lib.js';
import generateTool from '../skills/qrcode/tools/qrcode_generate/index.js';
import plugin from '../plugin.js';
import qrcodeCommand from '../commands/gen/index.js';
import scanCommand from '../commands/scan/[url]/index.js';

describe('@zhin.js/plugin-qrcode', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('qrcode');
  });

  it('builds the QR image locally as a PNG data URL', async () => {
    const url = await buildQrDataUrl('hello');
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(url).toBe((await generateQrCode('hello', { width: 300 })).toDataUrl());
    expect(await qrImageSegment('hello')).toEqual([{ type: 'image', data: { url } }]);
  });

  it('executes declared text and size through the real parser', async () => {
    expect(parseCommandDefinition(qrcodeCommand)).toBe(qrcodeCommand);
    expect(parseCommandDefinition(scanCommand)).toBe(scanCommand);
    const result = await commandIndex('gen', qrcodeCommand).dispatch({ input: 'gen hello beautiful world --size 512' });
    expect(result.status).toBe('executed');
    expect(isRawContent(result.value) && result.value.payload).toEqual({ type: 'image', data: { url: await buildQrDataUrl('hello beautiful world', 512) } });
  });

  it('uses defaults and reports invalid size without creating an image', async () => {
    const index = commandIndex('gen', qrcodeCommand);
    const result = await index.dispatch({ input: 'gen ping' });
    expect(isRawContent(result.value) && result.value.payload).toEqual({ type: 'image', data: { url: await buildQrDataUrl('ping') } });
    const invalid = await index.dispatch({ input: 'gen ping -s 10' });
    expect(invalid).toMatchObject({ status: 'invalid', issues: [{ field: '--size' }] });
    expect(invalid.value).toBeUndefined();
    const help = await index.dispatch({ input: 'gen --help', commandPrefix: '#' });
    expect(String(help.value)).toContain('#gen <text> [--size <integer>]');
    expect(String(help.value)).toContain('默认值：300');
  });

  it('never sends the QR content to a third party: command, Agent tool and Console action agree', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const secret = 'otpauth://totp/acme?secret=JBSWY3DPEHPK3PXP';
      const local = await buildQrDataUrl(secret);
      const command = await commandIndex('gen', qrcodeCommand).dispatch({ input: `gen ${secret}` });
      expect(isRawContent(command.value) && command.value.payload).toEqual({ type: 'image', data: { url: local } });
      expect(JSON.parse(String(await generateTool.execute({ text: secret }, {} as never)))).toEqual([{ type: 'image', data: { url: local } }]);

      let rpc: { methods: ReadonlyMap<string, { handler: (input: unknown, call: unknown) => any }> } | undefined;
      await (plugin as unknown as { setup: (context: unknown) => unknown }).setup({
        resources: { provide: (token: unknown, value: never) => { if (token === pluginConsoleRpcToken) rpc = value; } },
        lifecycle: { add: () => undefined },
      });
      // Methods are declared under their real names; nothing is added to the map afterwards.
      expect([...rpc!.methods.keys()]).toEqual(['status', 'generate', 'clear-history']);
      expect((await rpc!.methods.get('generate')!.handler({ text: secret, width: 300 }, {})).dataUrl).toBe(local);
      expect((await rpc!.methods.get('status')!.handler({}, {})).recentCount).toBe(1);
      await rpc!.methods.get('clear-history')!.handler({}, {});
      expect((await rpc!.methods.get('status')!.handler({}, {})).recentCount).toBe(0);
      const page = (await import('../pages/index/index.ts')).default as unknown as () => unknown;
      expect(JSON.stringify(page())).toContain('clear-history');
      expect(JSON.stringify(page())).not.toContain('clearHistory');

      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('scan validates the image URL before any request and bounds the request with a timeout', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify([{ symbol: [{ data: 'decoded', error: null }] }])));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const run = (url: string) => scanCommand.execute({ params: { url }, locale: 'zh-CN' } as never);
      for (const bad of ['not a url', 'ftp://example.org/qr.png', 'file:///etc/passwd', 'https://user:pw@example.org/qr.png', 'http://localhost/qr.png', `https://example.org/${'a'.repeat(2100)}`]) {
        expect(isScannableImageUrl(bad)).toBe(false);
        expect(await run(bad)).toBe('请提供有效的 HTTP/HTTPS 图片链接');
      }
      expect(fetchMock).not.toHaveBeenCalled();

      expect(await run('https://example.org/qr.png')).toBe('识别结果：decoded');
      const [api, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(api).toBe(`https://api.qrserver.com/v1/read-qr-code/?fileurl=${encodeURIComponent('https://example.org/qr.png')}`);
      expect(init.signal).toBeInstanceOf(AbortSignal);

      // A hanging decoder is cut off by the signal and reported as a failure.
      fetchMock.mockImplementationOnce((_url, hanging) => new Promise<Response>((_resolve, reject) => {
        expect(hanging?.signal).toBeInstanceOf(AbortSignal);
        reject(new DOMException('The operation timed out.', 'TimeoutError'));
      }));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(await run('https://example.org/qr.png')).toBe('二维码识别失败，请检查图片链接是否有效');
      warn.mockRestore();
    } finally { vi.unstubAllGlobals(); }
  });

  it('shows scan help before issuing a decode HTTP request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      for (const options of [undefined, {}]) {
        const index = commandIndex('scan/$url', { ...scanCommand, options, $parameter: { name: 'url', type: 'string' } });
        for (const input of ['scan --help', 'scan --help https://example.org', 'scan https://example.org --help']) {
          await expect(index.dispatch({ input })).resolves.toMatchObject({ status: 'executed', value: expect.stringContaining('scan <url>') });
        }
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([0, -1, 300.5, 1025, NaN, Infinity, '300&size=1'])('rejects invalid QR helper size %s', async (size) => {
    await expect(buildQrDataUrl('hello', size as number)).rejects.toThrow('integer between 64 and 1024');
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
