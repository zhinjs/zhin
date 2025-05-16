import { ImageOptions } from 'img-generator';

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

  export interface Options<T extends OutputType> extends ImageOptions {
    encoding: T;
  }
}
