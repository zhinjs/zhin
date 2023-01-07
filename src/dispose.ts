export type Dispose = {
    ():boolean
}
export type ToDispose<T>= T & Dispose
export namespace Dispose{
    export function from<T extends object>(source:T,callback):ToDispose<T>{
        return new Proxy(callback,{
            get(target, p: string | symbol, receiver: any): any {
                return Reflect.get(source, p, receiver)
            }
        })
    }
}