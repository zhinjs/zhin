/** Authoring API for Handler Feature — implementation in `@zhin.js/feature-kit`. */
export {
  defineHandler,
  parseHandlerDefinition,
  HandlerIndex,
  isHandlerIndex,
  handlerFeatureId,
  handlerFeature,
  type HandlerEventMap,
  type HandlerDefinition,
  type HandlerDescriptor,
} from '@zhin.js/feature-kit';

import type { Plugin } from '../plugin.js';

type KnownKeys<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

declare module '@zhin.js/feature-kit' {
  interface HandlerEventMap extends KnownKeys<Plugin.Lifecycle> {}
}
