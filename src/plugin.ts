import {Bot} from "@/bot";

export type Plugin<T = any>= (Plugin.Function<T> | Plugin.Object<T>) & {
    dispose?:Function
    anonymousCount?:number
    children?:Plugin[]
    version?:string
    functional?:boolean
    desc?:string
    author?:string|{name:string,email?:string}
    disposes?:Function[]
    fullName?:string
    fullPath?:string
    using?:(keyof Bot.Services)[]
    [key:string]:any
}
export namespace Plugin{
    export type Function<T>=(bot:Bot,options:T)=>void|Bot.Dispose<Bot>
    export interface Object<T>{
        install:Function<T>
    }
}