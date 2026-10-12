/**
 * Incoming Message and outbound envelope middleware authoring contracts.
 * @module zhin.js/middleware
 */
export {
  defineMiddleware,
  type MiddlewareContext,
  type MiddlewareContinuation,
  type MiddlewareDefinition,
  type MiddlewareDefinitionBase,
  type MiddlewareNext,
  type MiddlewarePhase,
  type MiddlewareTarget,
  type OutboundMiddlewareNext,
} from './middleware.js';
