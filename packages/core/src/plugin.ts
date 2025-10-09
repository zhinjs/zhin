// ============================================================================
// 插件类型定义（定义插件中间件、生命周期、命令、组件等核心类型）
// ============================================================================


import {MaybePromise} from '@zhin.js/types'
import {AdapterMessage, BeforeSendHandler, RegisteredAdapter, SendOptions} from "./types.js";
import {Message} from './message.js'
import {Dependency, Logger,} from "@zhin.js/hmr";
import {App} from "./app";
import {MessageCommand} from "./command.js";
import {Component} from "./component.js";
import { PluginError, MessageError, errorManager } from './errors.js';
import {remove} from "./utils.js";
import {Prompt} from "./prompt.js";
import { Schema } from '@zhin.js/database';
import { Cron} from './cron.js';

/** 消息中间件函数 */
export type MessageMiddleware<P extends RegisteredAdapter=RegisteredAdapter> = (message: Message<AdapterMessage<P>>, next: () => Promise<void>) => MaybePromise<void>;


// ============================================================================
// Plugin 类（插件的生命周期、命令/中间件/组件/定时任务等管理）
// ============================================================================

/**
 * 插件类：继承自 Dependency，提供机器人特定功能与生命周期管理。
 * 支持命令注册、中间件、组件、定时任务、模型等。
 */
export class Plugin extends Dependency<Plugin> {
    middlewares: MessageMiddleware<any>[] = [];
    components: Map<string, Component<any, any, any>> = new Map();
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
        super(parent, name, filePath);
        // 绑定消息事件，自动分发到命令和中间件
        this.on('message.receive',this.#handleMessage.bind(this))
        // 注册命令处理为默认中间件
        this.addMiddleware(async (message,next)=>{
            for(const command of this.commands){
                const result=await command.handle(message);
                if(result) message.$reply(result);
            }
            return next()
        });
        // 发送前渲染组件
        this.beforeSend((options)=>Component.render(this.components,options))
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
    async #handleMessage(message: Message) {
        try {
            await this.#runMiddlewares(message, 0)
        } catch (error) {
            const messageError = new MessageError(
                `消息处理失败: ${(error as Error).message}`,
                message.$id,
                message.$channel.id,
                { pluginName: this.name, originalError: error }
            )
            
            await errorManager.handle(messageError)
            
            // 可选：发送错误回复给用户
            try {
                await message.$reply('抱歉，处理您的消息时出现了错误。')
            } catch (replyError) {
                // 静默处理回复错误，避免错误循环
                // console.error 已替换为注释
            }
        }
    }
    cron(cronExpression:string,callback:()=>void){
        const cronJob = new Cron(cronExpression,callback);
        this.crons.push(cronJob);
        return this;
    }
    async #runMiddlewares(message: Message, index: number): Promise<void> {
        if (index >= this.middlewares.length) return
        
        const middleware = this.middlewares[index]
        
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
    addComponent<T = {}, D = {}, P = Component.Props<T>>(component:Component<T,D,P>){
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