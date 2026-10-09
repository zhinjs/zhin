/** Internal marker only; each frame additionally checks its exact carrier identity. */
export const continuationBrand: unique symbol = Symbol('zhin.middleware-continuation');

/** Opaque result of `next()`. Return it to preserve the downstream author. */
export interface MiddlewareContinuation {
  readonly [continuationBrand]: never;
}
