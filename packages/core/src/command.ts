import {MatchResult, SegmentMatcher} from "segment-matcher";
import {AdapterMessage, SendContent} from "./types.js";
import {RegisteredAdapter} from "./types.js";
import type {Message} from "./message.js";
import {MaybePromise} from "./types.js";
import {Plugin} from "./plugin.js";

/**
 * MessageCommand类：命令系统核心，基于segment-matcher实现。
 * 支持多平台命令注册、作用域限制、参数解析、异步处理等。
 */
export class MessageCommand<T extends RegisteredAdapter=RegisteredAdapter> extends SegmentMatcher{
    #callbacks:MessageCommand.Callback<T>[]=[];
    #desc:string[]=[];
    #usage:string[]=[];
    #examples:string[]=[];
    #permissions:string[]=[];
    get helpInfo():MessageCommand.HelpInfo{
        return {
            pattern: this.pattern,
            desc: this.#desc,
            usage: this.#usage,
            examples: this.#examples
        }
    }
    get help(){
        return [
            this.pattern,
            ...this.#desc,
            ...this.#usage,
            ...this.#examples
        ].join("\n");
    }
    desc(...desc:string[]){
        this.#desc.push(...desc)
        return this as MessageCommand<T>;
    }
    usage(...usage:string[]){
        this.#usage.push(...usage)
        return this as MessageCommand<T>;
    }
    examples(...examples:string[]){
        this.#examples.push(...examples)
        return this as MessageCommand<T>;
    }
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
    async handle(message:Message<AdapterMessage<T>>,plugin:Plugin):Promise<SendContent|undefined>{
        const auth = plugin.contextIsReady('permission') ? plugin.inject('permission') : null
        for(const permit of this.#permissions){
            const passed=await auth?.check(permit,message)
            if(!passed) return;
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
    export type Callback<T extends RegisteredAdapter>=(message:Message<AdapterMessage<T>>,result:MatchResult)=>SendContent|undefined|Promise<SendContent|undefined>;
    export type Checker<T extends RegisteredAdapter>=(message:Message<AdapterMessage<T>>)=>MaybePromise<boolean>
    export type HelpInfo={
        pattern:string;
        desc:string[];
        usage:string[];
        examples:string[];
    }
}