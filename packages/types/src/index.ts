
export type ArrayItem<T>=T extends Array<infer R>?R:unknown
export interface GlobalContext extends Record<string, any>{
}
export interface Models extends Record<string,object>{}
export type SideEffect<A extends (keyof GlobalContext)[]>=(...args:Contexts<A>)=>MaybePromise<void|DisposeFn<Contexts<A>>>
export type DisposeFn<A>=(context:ArrayItem<A>)=>MaybePromise<void>
export type Contexts<CS extends (keyof GlobalContext)[]>=CS extends [infer L,...infer R]?R extends (keyof GlobalContext)[]?[ContextItem<L>,...Contexts<R>]:never[]:never[]
type ContextItem<L>=L extends keyof GlobalContext?GlobalContext[L]:never
export type MaybePromise<T> = T extends Promise<infer U> ? T|U : T|Promise<T>;