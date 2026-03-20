/**
 * Type declarations for @resvg/resvg-js (when not shipped by the package)
 */
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
