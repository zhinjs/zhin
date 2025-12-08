import { EventEmitter } from 'events';
import * as path from 'path';
import {getLogger} from "@zhin.js/logger";
import { Contexts, GlobalContext, SideEffect} from "@zhin.js/types";
import { Schema } from "@zhin.js/schema";
import {Context, DependencyOptions,} from './types.js'
import { createError, ERROR_MESSAGES, DEFAULT_CONFIG, performGC } from './utils.js';
import { AsyncLocalStorage } from 'async_hooks';

// ============================================================================
// 依赖基类
// ============================================================================

/**
 * 依赖基类：提供事件系统和依赖层次结构管理
 */
export class Dependency<P extends Dependency<any> = any,O extends DependencyOptions=DependencyOptions> extends EventEmitter {
    /** 文件哈希值 */
    hash?: string;
    /** 文件修改时间 */
    mtime?: Date;
    /** Context 映射 */
    contexts: Map<string, Context>;
    /** 依赖映射 */
    dependencies: Map<string, P>;
    private readyPromise: Promise<void> | null = null;
    #schema:Schema= Schema.any({} as any);
    
    // 使用 AsyncLocalStorage 替换静态栈，解决并发加载时的上下文混乱问题
    private static storage = new AsyncLocalStorage<Dependency>();

    /** 获取当前活动的依赖 */
    static get currentDependency(): Dependency {
        const dep = this.storage.getStore();
        if (!dep) {
            // 尝试回退到栈顶？不，严格模式更好。
            // 但为了兼容某些同步构造场景（如果不在 runWith 上下文中），
            // 我们可能需要保持一个 fallbackStack？
            // 暂时抛出错误，强迫正确使用上下文。
            throw createError('No active dependency Context. Make sure you are calling this within a plugin initialization or properly wrapped context.');
        }
        return dep;
    }

    /** 
     * 在指定依赖的上下文中运行代码
     */
    static runWith<T>(dependency: Dependency, fn: () => T): T {
        return this.storage.run(dependency, fn);
    }

    /** 
     * 获取根依赖
     * 如果当前依赖是根，返回自身；否则递归查找父依赖直到根。
     */
    get root(): Dependency<any, any> {
        let current: Dependency<any, any> = this;
        while (current.parent) {
            current = current.parent;
        }
        return current;
    }

    /** 生命周期状态 */
    private lifecycleState: 'waiting' | 'ready' | 'disposed' = 'waiting';
    constructor(
        public parent: Dependency<P> | null,
        public name: string,
        public filename: string,
        public options:O={} as O
    ) {
        super();
        this.contexts = new Map();
        this.dependencies = new Map();
        this.setMaxListeners(DEFAULT_CONFIG.MAX_LISTENERS);
        
        // 不再压栈，上下文管理交给外部（ModuleLoader）通过 runWith 控制
        // Dependency.dependencyStack.push(this);
        
        // 初始化完成
        this.mounted();
    }
    defineSchema<S extends Schema>(rules:S):S{
        this.#schema=rules
        return rules as S;
    }
    get schema(){
        return this.#schema
    }
    validate(data: unknown): boolean {
        return this.#schema(data);
    }
    format(data: unknown): unknown {
        return this.#schema(data);
    }

    getLogger(namespace:string){
        return getLogger(namespace)
    }
    #contextsIsReady<CS extends (keyof GlobalContext)[]>(contexts:CS){
        if(!contexts.length) return true
        return contexts.every(name=>this.contextIsReady(name))
    }
    get isReady(){
        return this.lifecycleState==='ready'
    }
    get isDispose(){
        return this.lifecycleState==='disposed'
    }

    /** 获取生命周期状态 */
    getLifecycleState(): 'waiting' | 'ready' | 'disposed' {
        return this.lifecycleState;
    }

    /** 设置生命周期状态 */
    setLifecycleState(state: 'waiting' | 'ready' | 'disposed'): void {
        if (this.lifecycleState !== state) {
            const oldState = this.lifecycleState;
            this.lifecycleState = state;
            this.emit('lifecycle-changed', oldState, state);
        }
    }
    findParent(filename:string,callerFiles:string[]):Dependency<P>{
        const list=callerFiles.filter(item=>item!==filename)
        for(const file of list){
            const child=this.findChild(file)
            if(child) return child
        }
        return this
    }
    /** 查找子依赖 */
    findChild<T extends P>(filename: string): T | void {
        for (const [key, child] of this.dependencies) {
            if (child.filename === filename) return child as T
            const found = child.findChild<T>(filename);
            if (found) return found;
        }
    }

    /** 按名称查找插件 */
    findPluginByFilename<T extends P>(filename: string): T | void {
        for (const [key, child] of this.dependencies) {
            if (child.filename === filename) {
                return child as T;
            }
            const found = child.findPluginByFilename<T>(filename);
            if (found) {
                return found;
            }
        }
    }
    useContext<T extends (keyof GlobalContext)[]>(...args:[...T,sideEffect:SideEffect<T>]){
        const contexts=args.slice(0,-1) as T
        const sideEffect=args[args.length-1] as SideEffect<T>
        const contextReadyCallback=async ()=>{
            if(sideEffect.finished) return;
            sideEffect.finished=true;
            const args=contexts.map(item=>this.#use(item))
            const dispose=await sideEffect(...args as Contexts<T>)
            if(!dispose)return;
            const disposeFn=async (name:string)=>{
                if(contexts.includes(name)){
                    await dispose(this.#use(name))
                }
                this.off('context.dispose',disposeFn)
                sideEffect.finished=false;
            }
            this.on('context.dispose',disposeFn)
            this.on('dispose',()=>{
                this.off('context.dispose',disposeFn)
                dispose(args[0])
            })
        }
        const onContextMounted=async (name:string)=>{
            if(!this.#contextsIsReady(contexts)||!(contexts).includes(name)) return
            await contextReadyCallback()
        }
        this.on('context.mounted',onContextMounted)
        if(!this.#contextsIsReady(contexts)) return
        contextReadyCallback()
    }

    /** 分发事件，如果有上级，则继续上报，否则广播 */
    dispatch(eventName: string | symbol, ...args: unknown[]): void {
        if(this.parent) this.parent.dispatch(eventName,...args)
        else this.broadcast(eventName,...args)
    }

    /** 广播事件到所有子依赖 */
    broadcast(eventName: string | symbol, ...args: unknown[]): void {
        this.emit(eventName, ...args);
        for (const [key, child] of this.dependencies) {
            child.broadcast(eventName, ...args);
        }
    }

    /** 获取依赖列表 */
    get dependencyList(): P[] {
        return Array.from(this.dependencies.values());
    }

    /** 获取所有依赖（包括嵌套） */
    get allDependencies(): P[] {
        const result: P[] = [];
        for (const child of this.dependencyList) {
            result.push(child);
            result.push(...child.allDependencies);
        }
        return result;
    }

    /** 获取Context列表 */
    get contextList(): Context[] {
        return Array.from(this.dependencies.values()).reduce((result,dep)=>{
            result.push(...dep.contextList)
            return result
        },Array.from(this.contexts.values()));
    }
    get allContextList():Context[]{
        if(this.parent) return this.parent.allContextList
        return Array.from(this.dependencies.values()).reduce((result,dep)=>{
            result.push(...dep.contextList)
            return result
        },this.contextList)
    }

    /** 创建Context */
    register<T>(context: Context<T,P>): Context<T,P> {
        this.contexts.set(context.name, context as Context);
        this.dispatch('context.add',context)
        if(this.lifecycleState==='ready'){
            if(!context.value&&context.mounted){
                Promise.resolve(context.mounted(this as any)).then(res=>{
                    context.value=res
                    this.dispatch('context.mounted',context.name)
                })
            }else{
                this.dispatch('context.mounted',context.name)
            }
        }
        this.on('dispose',()=>{
            this.dispatch('context.remove',context)
        })
        return context;
    }

    /** 使用Context */
    #use<T extends keyof GlobalContext>(name: T): GlobalContext[T]
    #use<T>(name: string): T
    #use(name: string){
        const context = this.allContextList.find(c=>c.name===name)
        if (!context) {
            throw createError(ERROR_MESSAGES.CONTEXT_NOT_FOUND, { name });
        }
        if(!context.value) throw createError(ERROR_MESSAGES.CONTEXT_NOT_MOUNTED,{name})
        return context.value;
    }
    /** 等待就绪 */
    get waitMounted(): Promise<void> {
        if(this.lifecycleState==='ready') return Promise.resolve();
        if(this.lifecycleState==='disposed') throw createError(ERROR_MESSAGES.DEPENDENCY_DISPOSED);
        return new Promise<void>((resolve) => {
            this.on('self.mounted', resolve);
        });
    }
    contextIsReady<T extends keyof GlobalContext>(name:T){
        return this.allContextList.find(context=>context.name===name)?.value!==undefined
    }
    /** 安装完成回调 */
    async mounted(): Promise<void> {
        for (const context of this.contextList) {
            if (context.mounted && !context.value) {
                try {
                    context.value = await context.mounted(this);
                } catch (error) {
                    this.emit('error', error);
                    continue;
                }
            }
            this.dispatch('context.mounted',context.name)
        }
        this.dispatch('dependency.mounted',this)
        this.emit('self.mounted',this)
        this.setLifecycleState('ready');
    }

    /** 销毁依赖 */
    dispose(): void {
        if (this.lifecycleState === 'disposed') {
            return;
        }
        this.setLifecycleState('disposed');
        
        // 销毁所有子依赖
        for (const [key, child] of this.dependencies) {
            try {
                child.dispose();
            } catch (error) {
                this.emit('error', error);
            }
        }
        this.dependencies.clear();
        
        // 销毁所有Context
        for (const context of this.contextList) {
            if (context.dispose && context.value) {
                try {
                    context.dispose(context.value);
                    this.dispatch('context.dispose',context)
                } catch (error) {
                    this.emit('error', error);
                }
            }
        }
        this.contexts.clear();
        
        // 触发事件
        this.emit('dependency.dispose',this);
        this.emit('self.dispose',this);
        
        // 清理所有监听器
        this.removeAllListeners();
        
        // 显式清空引用
        this.parent = null;
        this.options = null as any;

        // 不需要再维护 dependencyStack
        
        // ✅ 移除手动 GC，让 V8 自动处理
        // performGC({ onDispose: true }, `dispose: ${this.filename}`);
    }
} 
