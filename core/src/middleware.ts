import { Adapter } from './adapter';
import { Message } from './message';
import { Adapters } from './app';

type Next = () => Promise<any | null>;
export type Middleware<P extends Adapters = Adapters> = Compose.Middleware<P>;
export namespace Middleware {
  export function compose<P extends Adapters>(middlewares: Middleware<P>[]): Compose.ComposedMiddleware<P> {
    if (!Array.isArray(middlewares)) throw new TypeError('Middleware stack must be an array!');
    for (const fn of middlewares) {
      if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!');
    }
    return (event: Message<P>, next?: Next) => {
      let index = -1;
      const dispatch: (i: number, ctx?: Message<P>) => Promise<any> = (i: number, ctx: Message<P> = event) => {
        if (i <= index) return Promise.reject(new Error('next() called multiple times'));
        index = i;
        let fn: Middleware<P> | undefined = middlewares[i];
        if (i === middlewares.length) fn = next;
        if (!fn) return Promise.resolve();
        try {
          return Promise.resolve(fn(ctx, dispatch.bind(null, i + 1)));
        } catch (err) {
          return Promise.reject(err);
        }
      };
      return dispatch(0);
    };
  }
}
export namespace Compose {
  export type Middleware<P extends Adapters> = (event: Message<P>, next: Next) => any;
  export type ComposedMiddleware<P extends Adapters> = (event: Message<P>, next?: Next) => Promise<void>;
}
