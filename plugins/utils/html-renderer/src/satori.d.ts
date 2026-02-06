/**
 * Type declarations for @zhinjs/satori
 */

declare module '@zhin.js/satori' {
  import type { JSDOM } from 'jsdom';

  export interface FontOptions {
    name: string;
    data: ArrayBuffer | Buffer;
    weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
    style?: 'normal' | 'italic';
    lang?: string;
  }

  export type Font = FontOptions;
  export type FontWeight = FontOptions['weight'];
  export type FontStyle = FontOptions['style'];

  export interface SatoriOptions {
    width?: number;
    height?: number;
    fonts: FontOptions[];
    embedFont?: boolean;
    debug?: boolean;
    graphemeImages?: Record<string, string>;
    loadAdditionalAsset?: (
      languageCode: string,
      segment: string
    ) => Promise<string | Array<FontOptions>>;
  }

  export function init(yoga: any): Promise<void>;
  
  export default function satori(
    dom: JSDOM,
    options: SatoriOptions
  ): Promise<string>;

  // 内置字体
  export interface BuiltinFont {
    name: string;
    data: ArrayBuffer;
    weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
    style: 'normal' | 'italic';
  }

  export function getRobotoRegular(): BuiltinFont | null;
  export function getRobotoBold(): BuiltinFont | null;
  export function getNotoSansCJK(): BuiltinFont | null;
  export function getNotoSansJP(): BuiltinFont | null;
  export function getNotoSansKR(): BuiltinFont | null;
  export function getAllBuiltinFonts(): BuiltinFont[];
  export function getDefaultFonts(): BuiltinFont[];
}

declare module '@resvg/resvg-js' {
  export interface ResvgRenderOptions {
    fitTo?: {
      mode: 'width' | 'height' | 'zoom' | 'original';
      value?: number;
    };
    background?: string;
    crop?: {
      left: number;
      top: number;
      right?: number;
      bottom?: number;
    };
  }

  export class Resvg {
    constructor(svg: string | Buffer, options?: ResvgRenderOptions);
    render(): RenderedImage;
    toString(): string;
    innerBBox(): BBox | undefined;
    getBBox(): BBox | undefined;
    cropByBBox(bbox: BBox): void;
    imagesToResolve(): string[];
    resolveImage(href: string, buffer: Buffer): void;
  }

  export interface RenderedImage {
    width: number;
    height: number;
    asPng(): Uint8Array;
  }

  export interface BBox {
    x: number;
    y: number;
    width: number;
    height: number;
  }
}
