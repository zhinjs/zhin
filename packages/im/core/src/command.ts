import { MatchResult, SegmentMatcher} from 'segment-matcher';
import { AdapterMessage, SendContent, RegisteredAdapter, MaybePromise } from './types.js';
import type {Message} from './message.js';
import {Plugin} from './plugin.js';
type ConstructFirstParam<T extends new (...args: any[]) => any> = T extends new (...args: [infer U, ...any[]]) => any ? U : never;
type ConstructSecondParam<T extends new (...args: any[]) => any> = T extends new (...args: [any, infer V, ...any[]]) => any ? V : never;

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
    constructor(C:ConstructFirstParam<typeof SegmentMatcher>,P:ConstructSecondParam<typeof SegmentMatcher>={}){
        super(C,{
            at:['qq','user_id'],
            face:['id'],
            mention:['qq','user_id'],
            html:['content'],
            markdown:['content'],
            image:['file','src','url'],
            video:['file','src','url'],
            audio:['file','src','url'],
            file:['file','src','url'],
            reply:['id','reply_id','message_id'],
            quote:['id','reply_id','message_id'],
            forward:['id','res_id','message_id'],
            location:['latitude','longitude'],
            ...P,
        });
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
    /** 命令要求的 permit 列表（空表示所有人可用） */
    get requiredPermits(): readonly string[] {
        return this.#permissions;
    }
    /** 与 handle 一致的 permit 校验，供帮助菜单等场景过滤不可见命令 */
    async checkPermits(message: Message<AdapterMessage<T>>, plugin: Plugin): Promise<boolean> {
        if (!this.#permissions.length) return true;
        const auth = plugin.contextIsReady('permission') ? plugin.inject('permission') : null;
        if (!auth) return false;
        for (const permit of this.#permissions) {
            if (!(await auth.check(permit, message))) return false;
        }
        return true;
    }
    /**
     * 处理消息，自动匹配命令并执行回调
     * @param message 消息对象
     * @param plugin 插件实例
     * @returns 命令返回内容或undefined
     */
    async handle(message:Message<AdapterMessage<T>>,plugin:Plugin):Promise<SendContent|undefined>{
        if (!(await this.checkPermits(message, plugin))) {
            return;
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