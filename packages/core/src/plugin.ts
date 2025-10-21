// ============================================================================
// 插件类型定义（定义插件中间件、生命周期、命令、组件等核心类型）
// ============================================================================


import * as fs from 'fs';
import {AdapterMessage, BeforeSendHandler,MessageMiddleware, RegisteredAdapter, SendOptions} from "./types.js";
import { PermissionItem,PermissionChecker } from './permissions.js';
import {Message} from './message.js'
import {Dependency, Logger,} from "@zhin.js/hmr";
import {App} from "./app";
import {MessageCommand} from "./command.js";
import {Component, renderComponents} from "./component.js";
import { PluginError, MessageError, errorManager } from './errors.js';
import {remove} from "./utils.js";
import {Prompt} from "./prompt.js";
import { Schema } from '@zhin.js/database';
import { Cron} from './cron.js';


// ============================================================================
// Plugin 类（插件的生命周期、命令/中间件/组件/定时任务等管理）
// ============================================================================

/**
 * 插件类：继承自 Dependency，提供机器人特定功能与生命周期管理。
 * 支持命令注册、中间件、组件、定时任务、模型等。
 */
export class Plugin extends Dependency<Plugin> {
    middlewares: MessageMiddleware<RegisteredAdapter>[] = [];
    components: Map<string, Component<any>> = new Map();
    permissions: PermissionItem<RegisteredAdapter>[]=[];
    schemas: Map<string,Schema<any>>=new Map();
    commands:MessageCommand[]=[];
    crons:Cron[]=[];
    #logger?:Logger
    /**
     * 构造函数：初始化插件，注册消息事件、命令中间件、资源清理等
     * @param parent 所属 App 实例
     * @param name 插件名
     * @param filePath 插件文件路径
     */
    constructor(parent: Dependency<Plugin>, name: string, filePath: string) {
        filePath=fs.realpathSync(filePath);
        super(parent, name, filePath);
        this.logger.debug(`plugin ${name} created at ${filePath}`);
        // 绑定消息事件，自动分发到命令和中间件
        // 发送前渲染组件
        this.beforeSend((options)=>renderComponents(this.components,options))
        // 资源清理：卸载时清空模型、定时任务等
        this.on('dispose',()=>{
            for(const name of this.schemas.keys()){
                this.app.database?.models.delete(name);
            }
            this.schemas.clear();
            for(const cron of this.crons){
                cron.dispose();
            }
            this.crons.length = 0;
        });
        // 挂载时启动定时任务
        this.on('mounted',()=>{
            for(const cron of this.crons){
                cron.run();
            }
        });
    }
    addPermit<T extends RegisteredAdapter>(name:string|RegExp,check:PermissionChecker<T>){
        this.permissions.push({name,check});
        return this;
    }
    getPermit<T extends RegisteredAdapter>(name:string):PermissionItem<T>|undefined{
        return this.app.permissions.get(name);
    }
    cron(cronExpression:string,callback:()=>void){
        const cronJob = new Cron(cronExpression,callback);
        this.crons.push(cronJob);
        return this;
    }
    async #runMiddlewares(message: Message, index: number): Promise<void> {
        const middlewareList=[...this.app.middlewares,...this.middlewares]
        if (index >= middlewareList.length) return
        
        const middleware = middlewareList[index]
        
        try {
            await middleware(message, () => this.#runMiddlewares(message, index + 1))
        } catch (error) {
            throw new PluginError(
                `中间件执行失败: ${(error as Error).message}`,
                this.name,
                { middlewareIndex: index, originalError: error }
            )
        }
    }
    defineModel<S extends Record<string,any>>(name:string,schema:Schema<S>){
        this.schemas.set(name,schema);
        return this;
    }
    beforeSend(handler:BeforeSendHandler){
        this.before('message.send',handler)
    }
    before(event:string,listener:(...args:any[])=>any){
        this.on(`before-${event}`,listener)
    }
    /** 获取所属的App实例 */
    get app(): App {
        return this.parent as App;
    }
    get logger(): Logger {
        if(this.#logger) return this.#logger
        const names = [];
        let temp=this as Dependency<Plugin>
        while(temp.parent){
            names.unshift(temp.name)
            temp=temp.parent
        }
        return temp.getLogger(names.join('/'))
    }
    /** 添加组件 */
    addComponent<T=any>(component:Component<T>){
        this.components.set(component.name,component);
    }
    /** 添加中间件 */
    addCommand(command:MessageCommand){
        this.commands.push(command);
        this.dispatch('command.add',command);
    }
    /** 添加中间件 */
    addMiddleware<T extends RegisteredAdapter>(middleware: MessageMiddleware<T>) {
        this.middlewares.push(middleware);
        this.dispatch('middleware.add',middleware)
        return ()=>{
            remove(this.middlewares,middleware)
        }
    }
    prompt<P extends RegisteredAdapter>(message:Message<AdapterMessage<P>>){
        return new Prompt<P>(this,message)
    }



    /** 发送消息 */
    async sendMessage(options: SendOptions): Promise<void> {
        try {
            await this.app.sendMessage(options);
        } catch (error) {
            const messageError = new MessageError(
                `发送消息失败: ${(error as Error).message}`,
                undefined,
                (options as any).channel_id,
                { pluginName: this.name, sendOptions: options, originalError: error }
            )
            
            await errorManager.handle(messageError)
            throw messageError
        }
    }
    recallMessage(adapter:string,bot:string,id:string){
        try{
            this.app.recallMessage(adapter,bot,id)
        }catch(error){
            const messageError = new MessageError(
                `撤回消息失败: ${(error as Error).message}`,
                id,
                undefined,
                { originalError: error }
            )
            errorManager.handle(messageError)
            throw messageError
        }
    }

    /** 销毁插件 */
    dispose(): void {
        try {
            // 移除所有中间件
            for (const middleware of this.middlewares) {
                this.dispatch('middleware.remove', middleware)
            }
            this.middlewares = []
            
            // 调用父类的dispose方法
            super.dispose()
        } catch (error) {
            const pluginError = new PluginError(
                `插件销毁失败: ${(error as Error).message}`,
                this.name,
                { originalError: error }
            )
            
            errorManager.handle(pluginError).catch(console.error)
            throw pluginError
        }
    }
}