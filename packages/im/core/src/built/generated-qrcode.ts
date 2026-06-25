import QRCode from 'qrcode';

export interface GenerateQrCodeOptions {
  width?: number;
  margin?: number;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

export interface PrintQrCodeTerminalOptions {
  small?: boolean;
}

/** 二维码实例：一次 generate，多种输出 */
export class GeneratedQrCode {
  readonly #text: string;
  readonly #dataUrl: string;

  private constructor(text: string, dataUrl: string) {
    this.#text = text;
    this.#dataUrl = dataUrl;
  }

  static async generate(text: string, options: GenerateQrCodeOptions = {}): Promise<GeneratedQrCode> {
    const dataUrl = await QRCode.toDataURL(text, {
      width: options.width ?? 280,
      margin: options.margin ?? 2,
      errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
    });
    return new GeneratedQrCode(text, dataUrl);
  }

  /** data URL，含 `data:image/png;base64,...` 前缀 */
  toDataUrl(): string {
    return this.#dataUrl;
  }

  /**
   * encoding === 'base64' → 纯 base64 载荷（无 data: 前缀）
   */
  toString(encoding: 'base64'): string {
    if (encoding !== 'base64') {
      throw new Error(`GeneratedQrCode.toString: unsupported encoding "${encoding}"`);
    }
    const prefix = 'data:image/png;base64,';
    if (!this.#dataUrl.startsWith(prefix)) {
      throw new Error('GeneratedQrCode.toString: unexpected data URL format');
    }
    return this.#dataUrl.slice(prefix.length);
  }

  /** 输出 ASCII 二维码到 process.stdout */
  async printToTerminal(options: PrintQrCodeTerminalOptions = {}): Promise<void> {
    const terminalText = await QRCode.toString(this.#text, {
      type: 'terminal',
      small: options.small ?? true,
    });
    process.stdout.write(`${terminalText}\n`);
  }
}

/** 便捷别名 */
export const generateQrCode = GeneratedQrCode.generate.bind(GeneratedQrCode);
