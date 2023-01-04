import {Bot} from "@/bot";

export interface PluginInfo{
    fullName?:string
    version?:string
    fullPath?:string
    type?:string
    desc?:string
    author?:string|{name:string,email?:string}
}
export type Plugin<T = any>= (Plugin.Function<T> | Plugin.Object<T>) & {
    dispose?:Function
    anonymousCount?:number
    children?:Plugin[]
    functional?:boolean
    disposes?:Function[]
    using?:(keyof Bot.Services)[]
    [key:string]:any
} & PluginInfo
export namespace Plugin{
    export type Function<T>=(bot:Bot,options:T)=>void|Bot.Dispose<Bot>
    export interface Object<T>{
        install:Function<T>
    }
}