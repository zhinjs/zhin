import {Adapter, AdapterBot, AdapterReceive} from "@/adapter";
import { Bot } from '@/types';
import { Message } from '@/message';

type Next = () => Promise<any | null>;
export type Middleware<AD extends Adapter=Adapter> = Compose.Middleware<AD>;
export namespace Middleware {
    export function compose<AD extends Adapter>(middlewares: Middleware[]): Compose.ComposedMiddleware<AD> {
        if (!Array.isArray(middlewares)) throw new TypeError("Middleware stack must be an array!");
        for (const fn of middlewares) {
            if (typeof fn !== "function")
                throw new TypeError("Middleware must be composed of functions!");
        }
        return (adapter:AD,bot:Bot<AD>,event:Message<AD>, next?: Next) => {
            let index = -1;
            const dispatch: (i: number, ctx?: Message<AD>) => (Promise<any>) = (i:number, ctx:Message<AD> = event) => {
                if (i <= index) return Promise.reject(new Error("next() called multiple times"));
                index = i;
                let fn:Middleware<AD>|undefined = middlewares[i];
                if (i === middlewares.length) fn = next;
                if (!fn) return Promise.resolve();
                try {
                    return Promise.resolve(fn(adapter,bot,ctx, dispatch.bind(null, i + 1)));
                } catch (err) {
                    return Promise.reject(err);
                }
            };
            return dispatch(0);
        };
    }
}
export namespace Compose {
    export type Middleware<AD extends Adapter> = (adapter:AD,bot:Bot<AD>,event:Message<AD>, next: Next) => any;
    export type ComposedMiddleware<AD extends Adapter>  = (adapter:AD,bot:Bot<AD>,event:Message<AD>, next?: Next) => Promise<void>;
}
