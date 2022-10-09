import {Bot} from "@/bot";

export type Plugin<T = any>= (Plugin.Function<T> | Plugin.Object<T>) & {
    dispose?:Bot.Dispose
    version?:string
    desc?:string
    author?:string|{name:string,email?:string}
    disposes?:Bot.Dispose[]
    fullName?:string
    fullPath?:string
    using?:(keyof Bot.Services)[]
    [key:string]:any
}
export namespace Plugin{
    export type Function<T>=(bot:Bot,options:T)=>any
    export interface Object<T>{
        install:Function<T>
        name:string
    }
}