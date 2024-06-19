import * as process from 'process';
import puppeteer from 'puppeteer-core';

export class Renderer {
  constructor(
    public type: string,
    public endpoint: string = process.env.ENDPOINT,
  ) {}

  async connect() {
    return (this.browser = await puppeteer.connect({
      browserWSEndpoint: this.endpoint,
    }));
  }
}
export namespace Renderer {
  export interface OutputTypeMap {
    base64: string;
    buffer: Buffer;
  }
  export type Output<T extends OutputType> = OutputTypeMap[T];
  export type OutputType = keyof OutputTypeMap;
  export interface Options<T extends OutputType> {
    encoding: T;
  }
}
