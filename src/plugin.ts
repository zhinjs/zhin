import {App} from "@/app";

export interface PluginInfo{
    fullName?:string
    version?:string
    fullPath?:string
    type?:string
    desc?:string
    author?:string|{name:string,email?:string}
}
export type PluginOptions<T=any>=Plugin.Function<T>|Plugin.Object<T>
export function definePlugin<T>(plugin:PluginOptions<T>){
    return plugin
}
export type Plugin<T = any>= PluginOptions<T> & {
    dispose?:Function
    anonymousCount?:number
    children?:Plugin[]
    functional?:boolean
    disposes?:Function[]
    using?:(keyof App.Services)[]
    [key:string]:any
} & PluginInfo
export namespace Plugin{
    export type Function<T>=(bot:App, options:T)=>void|App.Dispose<App>
    export interface Object<T>{
        install:Function<T>
    }
}