import {Bot,BotConfig} from "./bot.js";
import {Plugin} from "./plugin.js";
/**
 * Adapter类：适配器抽象，管理多平台Bot实例。
 * 负责根据配置启动/关闭各平台机器人，统一异常处理。
 */
export class Adapter<R extends Bot=Bot>{
    /** 当前适配器下所有Bot实例，key为bot名称 */
    public bots:Map<string,R>=new Map<string, R>()
    #botFactory:Adapter.BotFactory<R>
    /**
     * 构造函数
     * @param name 适配器名称（如 'process'、'qq' 等）
     * @param botFactory Bot工厂函数或构造器
     */
    constructor(public name:string,botFactory:Adapter.BotFactory<R>) {
        this.#botFactory=botFactory
    }
    /**
     * 启动适配器，自动根据配置创建并连接所有Bot
     * @param plugin 所属插件实例
     */
    async start(plugin:Plugin){
        const configs=plugin.app.getConfig().bots?.filter(c=>c.context===this.name)
        if(!configs?.length) return
        try {
            for(const config of configs){
                let bot: R
                if (Adapter.isBotConstructor(this.#botFactory)) {
                    bot = new this.#botFactory(plugin,config) as R
                } else {
                    bot = this.#botFactory(plugin,config) as R
                }
                try {
                    await bot.$connect()
                    plugin.logger.info(`bot ${config.name} of adapter ${this.name} connected`)
                    this.bots.set(config.name,bot)
                } catch (error) {
                    // 如果连接失败，确保错误正确传播
                    throw error
                }
            }

            plugin.logger.info(`adapter ${this.name} started`)
        } catch (error) {
            // 确保错误正确传播
            throw error
        }
    }
    /**
     * 停止适配器，断开并移除所有Bot实例
     * @param plugin 所属插件实例
     */
    async stop(plugin:Plugin){
        try {
            for(const [name,bot] of this.bots){
                try {
                    await bot.$disconnect()
                    plugin.logger.info(`bot ${name} of adapter ${this.name} disconnected`)
                    this.bots.delete(name)
                } catch (error) {
                    // 如果断开连接失败，确保错误正确传播
                    throw error
                }
            }
            plugin.logger.info(`adapter ${this.name} stopped`)
        } catch (error) {
            // 确保错误正确传播
            throw error
        }
    }
}
export namespace Adapter {
    export type BotBotConstructor<T extends Bot>=T extends Bot<infer F,infer S> ? {
        new(plugin:Plugin,config:S):T
    }: {
        new(plugin:Plugin,config:BotConfig):T
    }
    export function isBotConstructor<T extends Bot>(fn: BotFactory<T>): fn is BotBotConstructor<T> {
        return fn.prototype &&
            fn.prototype.constructor === fn
    }
    export type BotCreator<T extends Bot>=T extends Bot<infer F,infer S> ? (plugin:Plugin,config: S) => T : (plugin:Plugin,config: BotConfig) => T
    export type BotFactory<T extends Bot> = BotBotConstructor<T>|BotCreator<T>
}