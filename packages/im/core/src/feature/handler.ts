/** Authoring API for Handler Feature — implementation in `@zhin.js/handler`. */
export {
  defineHandler,
  parseHandlerDefinition,
  HandlerIndex,
  isHandlerIndex,
  handlerFeatureId,
  handlerFeature,
  handlerEventFromLocalName,
  resolveHandlerEvent,
  type HandlerEventMap,
  type HandlerDefinition,
  type HandlerDescriptor,
  type HandlerContext,
  type HandlerPrompt,
  type HandlerDispatchOptions,
} from '@zhin.js/handler';

import type { Plugin } from '../plugin.js';

type KnownKeys<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

declare module '@zhin.js/handler' {
  interface HandlerEventMap extends KnownKeys<Plugin.Lifecycle> {}
}
