import {App} from "@/app";
import {Dispose} from "@/dispose";

export interface PluginInfo{
    version?:string
    type?:string
    desc?:string
    author?:string|{name:string,email?:string}
}
export interface Plugins{
    help:Plugin<null>
    logs:Plugin<null>
    login:Plugin<null>
    plugin:Plugin<null>
    config:Plugin<null>
    daemon:Plugin<null>
    status:Plugin<null>
    watcher:Plugin<string>
    [key:string]:Plugin
}
export type PluginOptions<P extends Plugin>=P extends Plugin<infer R>?R:unknown
export type Plugin<T = any>= (Plugin.Object<T> | Plugin.Function<T>)& {
    dispose?:Function
    setup?:boolean
    app?:App
    anonymousCount?:number
    children?:Plugin[]
    functional?:boolean
    disposes?:Function[]
    fullName?:string
    fullPath?:string
    [key:string]:any
} & PluginInfo
export namespace Plugin{
    export type Function<T>=(bot:App, options:T)=>void|Dispose
    export interface Object<T>{
        name?:string
        install:Function<T>
    }
}