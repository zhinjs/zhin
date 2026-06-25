import { describe, it, expect } from 'vitest';
import { GeneratedQrCode, generateQrCode } from '../src/built/generated-qrcode.js';

describe('GeneratedQrCode', () => {
  it('generate produces data URL and base64 payload', async () => {
    const qr = await GeneratedQrCode.generate('https://example.com/bind');
    expect(qr.toDataUrl()).toMatch(/^data:image\/png;base64,/);
    const base64 = qr.toString('base64');
    expect(base64.length).toBeGreaterThan(20);
    expect(qr.toDataUrl()).toContain(base64);
  });

  it('generateQrCode alias works', async () => {
    const qr = await generateQrCode('hello');
    expect(qr.toDataUrl()).toMatch(/^data:image\/png;base64,/);
  });

  it('toString rejects unsupported encoding', async () => {
    const qr = await GeneratedQrCode.generate('x');
    expect(() => qr.toString('utf8' as 'base64')).toThrow(/unsupported encoding/);
  });

  it('printToTerminal writes to stdout', async () => {
    const qr = await GeneratedQrCode.generate('terminal-test');
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    await qr.printToTerminal();
    spy.mockRestore();
    expect(chunks.join('')).toMatch(/\S/);
  });
});
