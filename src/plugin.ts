import {getPackageInfo, remove} from "@/utils";
import {Dispose} from "@/dispose";
import {Context} from "@/context";
import {Zhin} from "@/zhin";
import {resolve} from "path";

export interface Plugin<T=any>{
    context:Context<T>
}
export class Plugin<T=any>{
    public name:string
    constructor(public options:Plugin.Options<T>,public info:Plugin.Info) {
        this.name=options.name
    }
    get type(){
        if(this.options.fullPath.startsWith(__dirname)) return 'built'
        if(this.options.fullName.startsWith('@zhinjs/plugin-')) return 'official'
        if(this.options.fullPath.startsWith(resolve(process.cwd(),this.context.app.options.plugin_dir))) return 'custom'
        return 'community'
    }
    install(ctx:Context,config:T){
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
    dispose(){
        this.context.app.emit('plugin-remove',this)
        this.context.parent.plugins.delete(this.options.fullName)
        this.context.logger.info('已卸载',this.name)
        this.context.dispose()
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