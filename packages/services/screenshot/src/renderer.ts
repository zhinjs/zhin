import { ScreenshotOptions, Viewport, WaitForOptions } from 'puppeteer-core';

export class Renderer {
  constructor(public type: string) {}
}

export namespace Renderer {
  export interface OutputTypeMap {
    base64: string;
    binary: Buffer;
  }

  export type Output<T extends OutputType> = OutputTypeMap[T];
  export type OutputType = keyof OutputTypeMap;

  export interface Options<T extends OutputType> extends ScreenshotOptions {
    encoding: T;
    viewport?: Viewport;
    waitFor?: WaitForOptions;
  }
}
