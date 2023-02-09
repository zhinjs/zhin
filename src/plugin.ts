import {getPackageInfo, remove} from "@/utils";
import {Dispose} from "@/dispose";
import {Context} from "@/context";
import {Zhin} from "@/zhin";
import {resolve} from "path";
import {Session} from "@/session";

export interface Plugin<T=any>{
    context:Context
}
export class Plugin<T=any>{
    public name:string
    public enableBots:`${keyof Zhin.Adapters}:${string|number}`[]=[]
    public disableBots:`${keyof Zhin.Adapters}:${string|number}`[]=[]
    constructor(public options:Plugin.Options<T>,public info:Plugin.Info) {
        this.name=options.name
    }
    enable<P extends keyof Zhin.Adapters>(bot:Zhin.Bots[P]){
        this.enableBots.push(`${bot.adapter.protocol}:${bot.self_id}`)
    }
    disable<P extends keyof Zhin.Adapters>(bot:Zhin.Bots[P]){
        this.disableBots.push(`${bot.adapter.protocol}:${bot.self_id}`)
    }
    get type(){
        if(this.options.fullPath.startsWith(__dirname)) return 'built'
        if(this.options.fullName.startsWith('@zhinjs/plugin-')) return 'official'
        if(this.options.fullPath.startsWith(resolve(process.cwd(),this.context.app.options.plugin_dir))) return 'custom'
        if(this.options.fullName.startsWith('zhinjs-plugin-')) return 'community'
        return 'unknown'
    }
    match<P extends keyof Zhin.Adapters>(session:Session<P>){
        const flag:`${keyof Zhin.Adapters}:${string|number}`=`${session.protocol}:${session.bot.self_id}`
        return (this.enableBots.includes(flag) || !this.disableBots.includes(flag)) && (this.options.scopes===undefined || this.options.scopes.length===0 || this.options.scopes.includes(session.protocol))
    }
    mount(ctx:Context,config:T){
        this.context=ctx
        const result=this.options.install.apply(this,[ctx,config])
        if(result){
            const dispose=()=>{
                result()
                remove(ctx.disposes,dispose)
            }
            ctx.disposes.push(dispose)
        }
    }
    unmount(){
        this.context?.app.emit('plugin-remove',this)
        this.context?.parent.plugins.delete(this.options.fullName)
        this.context?.logger.info('已卸载',this.name)
        this.context?.dispose()
        this.context=null
    }
}
export namespace Plugin{
    export type InstallFunction<T>=(parent:Context, config:T)=>void|Dispose
    export interface InstallObject<T>{
        name?:string
        install:InstallFunction<T>
    }
    export function defineOptions<T=any>(options:Install<T>):Options<T>{
        const baseOption:Omit<Options<T>, 'install'>={
            setup:false,
            anonymous:false,
            functional:false,
            anonymousCount:0,
        }
        return typeof options==="function"?{
            ...baseOption,
            functional:true,
            anonymous:options.prototype===undefined,
            install:options,
        }:{
            ...baseOption,
            functional:false,
            ...options,
        }
    }
    export type Install<T=any>=InstallFunction<T>|InstallObject<T>
    export type Config<P extends Install>=P extends Install<infer R>?R:unknown
    export interface Info{
        version?:string
        type?:string
        desc?:string
        author?:string|{name:string,email?:string}
    }
    export function getInfo(pluginPath:string):Info{
        if(!pluginPath) return {}
        return getPackageInfo(pluginPath)
    }
    export type Options<T = any>=InstallObject<T> & {
        type?:string
        scopes?:(keyof Zhin.Adapters)[]
        using?:(keyof Zhin.Services)[]
        setup?:boolean
        anonymous?:boolean
        anonymousCount?:number
        functional?:boolean
        fullName?:string
        fullPath?:string
    }
}