import {MatchResult, SegmentMatcher} from "segment-matcher";
import {AdapterMessage, SendContent} from "./types.js";
import {RegisteredAdapters} from "@zhin.js/types";
import type {Message} from "./message.js";
import {MaybePromise} from "@zhin.js/types";
import { ZhinError } from "./errors.js";
import { App } from "./app.js";

/**
 * MessageCommand类：命令系统核心，基于segment-matcher实现。
 * 支持多平台命令注册、作用域限制、参数解析、异步处理等。
 */
export class MessageCommand<T extends keyof RegisteredAdapters=keyof RegisteredAdapters> extends SegmentMatcher{
    #callbacks:MessageCommand.Callback<T>[]=[];
    #permissions:string[]=[];
    #checkers:MessageCommand.Checker<T>[]=[]
    /**
     * 注册命令回调
     * @param callback 命令处理函数
     */
    action(callback:MessageCommand.Callback<T>){
        this.#callbacks.push(callback)
        return this as MessageCommand<T>;
    }
    permit(...permissions:string[]){
        this.#permissions.push(...permissions)
        return this as MessageCommand<T>;
    }
    /**
     * 处理消息，自动匹配命令并执行回调
     * @param message 消息对象
     * @param plugin 插件实例
     * @returns 命令返回内容或undefined
     */
    async handle(message:Message<AdapterMessage<T>>,app:App):Promise<SendContent|undefined>{
        for(const permission of this.#permissions){
            const permit=app.permissions.get(permission)
            if(!permit) {
                throw new ZhinError(`权限 ${permission} 不存在`)
            }
            const result=await permit.check(permission,message)
            if(!result) return;
        }
        for(const check of this.#checkers){
            const result=await check(message)
            if(!result) return;
        }
        const matched=this.match(message.$content);
        if(!matched) return
        for(const handler of this.#callbacks){
            const result=await handler(message,matched)
            if(result) return result
        }
    }
}
export namespace MessageCommand{
    export type Callback<T extends keyof RegisteredAdapters>=(message:Message<AdapterMessage<T>>,result:MatchResult)=>MaybePromise<SendContent|void>;
    export type Checker<T extends keyof RegisteredAdapters>=(message:Message<AdapterMessage<T>>)=>MaybePromise<boolean>
}