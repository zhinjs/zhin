import type { EventMap } from 'qq-official-bot';
import type { QqAdapter } from './adapter.js';

export type QqClientEventMap = { readonly [K in keyof EventMap]: EventMap[K] extends (event: infer E, ...args: never[]) => unknown ? E : never };

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly qq: QqAdapter; }
}
