
export type Dict<T extends any=any,K extends (symbol|string)=string>={
    [P in K]:T
}
export type Define<D extends Dict,K extends string,V extends any=any>={
    [P in (K|keyof D)]:P extends keyof D?D[P]:P extends K?V:unknown
}
export type Awaitable<R extends any=void>=R|Promise<R>
export type PackageJson={
    main:string
    name:string
    version?:string
    using?:string[]
    setup?:boolean
}