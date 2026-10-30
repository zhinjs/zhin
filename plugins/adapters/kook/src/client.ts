import type { EventMap } from 'kook-client';
import type { KookAdapter } from './adapter.js';

export type KookClientEventMap = { readonly [K in keyof EventMap]: EventMap[K] extends (event: infer E, ...args: never[]) => unknown ? E : never };

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly kook: KookAdapter; }
}
