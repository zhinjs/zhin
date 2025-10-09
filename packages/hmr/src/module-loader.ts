import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { pathToFileURL } from 'url';
import { EventEmitter } from 'events';
import { Dependency } from './dependency.js';
import { HMR } from './hmr.js';
import { Logger } from './types.js';
import {createError, ERROR_MESSAGES, isBun, isCommonJS, performGC} from './utils.js';

/**
 * 模块加载器
 * 负责模块的导入、移除和哈希计算
 */
export class ModuleLoader<P extends Dependency = Dependency> extends EventEmitter {
    readonly #logger: Logger;
    readonly #hashAlgorithm: string;
    readonly #loadingDependencies: Set<string>=new Set();
    readonly #reloadDependencies: Set<string>=new Set();
    constructor(
        private readonly hmr: HMR<P>,
        logger: Logger,
        hashAlgorithm: string,
    ) {
        super();
        this.#logger = logger;
        this.#hashAlgorithm = hashAlgorithm;
    }

    /** 获取依赖映射 */
    get dependencies(): Map<string, P> {
        return this.hmr.dependencies;
    }

    /** 获取依赖列表 */
    get dependencyList(): P[] {
        return Array.from(this.dependencies.values());
    }

    /** 添加模块 */
    async add(name:string,filePath: string): Promise<void> {
        // 如果已经存在，先移除
        if (this.dependencies.has(filePath)) {
            this.remove(filePath);
            performGC({ onReload: true }, `reload: ${name}`);
        }
        
        try {
            await this.import(name, filePath);
        } catch (error) {
            this.#logger.error(error);
            this.emit('error', error);
            throw error;
        }
    }

    /** 移除模块 */
    remove(filePath: string): void {
        const dependency = this.dependencies.get(filePath);
        if (!dependency) {
            return;
        }
        // 先移除子依赖
        for (const [childPath] of dependency.dependencies) {
            this.remove(childPath);
        }
        // 移除缓存
        // @ts-ignore
        const cache=isBun?require?.cache?.[filePath]||import.meta?.cache?.[filePath]:
            isCommonJS?require?.cache?.[filePath]:
                // @ts-ignore
                import.meta?.cache?.[filePath]
        if(cache){
            delete require?.cache?.[filePath];
            // @ts-ignore
            delete import.meta?.cache?.[filePath];
        }
        // 销毁依赖
        dependency.dispose();
        
        // 从依赖映射中删除
        this.dependencies.delete(filePath);
        
        this.emit('remove', dependency);
    }

    /** 导入模块 */
    async import(name: string, filePath: string): Promise<P> {
        // 检查循环依赖
        if (this.#loadingDependencies.has(filePath)) {
            throw createError(ERROR_MESSAGES.CIRCULAR_DEPENDENCY, { filePath });
        }

        try {
            this.#loadingDependencies.add(filePath);
            
            // 创建新的依赖
            const dependency = this.hmr.createDependency(name, filePath);
            this.hmr.dependencies.set(filePath, dependency);
            
            // 记录文件信息
            const stats = fs.statSync(filePath);
            dependency.mtime = stats.mtime;
            dependency.hash = this.calculateHash(filePath);
            
            try {
                // 动态导入模块 - 针对 bun 的缓存清除
                const fileUrl = pathToFileURL(filePath).href;
                
                
                const importUrl: string=`${fileUrl}?t=${Date.now()}`;
                
                await import(importUrl);

                this.emit('add', this);
                return dependency;
            } catch (error) {
                // 导入失败，清理依赖
                this.dependencies.delete(filePath);
                throw error;
            }
        } finally {
            this.#loadingDependencies.delete(filePath);
        }
    }

    /** 重新加载模块 */
    async reload(filePath: string): Promise<void> {
        if(!this.dependencies.has(filePath) && !this.#reloadDependencies.has(filePath)){
            return;
        }
        this.#reloadDependencies.add(filePath);
        const dep=this.hmr.dependencies.get(filePath)!
        // 重新导入
        await this.add(dep?.name,filePath);
        this.#reloadDependencies.delete(filePath);
        this.emit('reload', filePath);
    }

    /** 检查文件是否已更改 */
    hasFileChanged(filePath: string): boolean {
        const dependency = this.dependencies.get(filePath);
        if (!dependency) {
            return true;
        }

        try {
            const stats = fs.statSync(filePath);
            const currentHash = this.calculateHash(filePath);
            
            // 先检查修改时间（快速检查）
            if (dependency.mtime && stats.mtime <= dependency.mtime) {
                return false;
            }
            
            // 再检查哈希（精确检查）
            return dependency.hash !== currentHash;
        } catch (error) {
            this.#logger.error('Error checking file changes', { filePath, error });
            return false;
        }
    }

    /** 计算文件哈希 */
    calculateHash(filePath: string): string {
        if(fs.statSync(filePath).isDirectory()) return ''
        try {
            const content = fs.readFileSync(filePath);
            return crypto.createHash(this.#hashAlgorithm).update(content).digest('hex');
        } catch (error) {
            this.#logger.error('Error calculating file hash', { filePath, error });
            return '';
        }
    }

    /** 查找依赖 */
    findDependency(name: string): P | undefined {
        for (const dependency of this.dependencies.values()) {
            if (dependency.name === name) {
                return dependency;
            }
        }
        return undefined;
    }

    /** 获取所有依赖名称 */
    getDependencyNames(): string[] {
        return Array.from(this.dependencies.values()).map(dep => dep.name);
    }

    /** 清理所有依赖 */
    dispose(): void {
        for (const [filePath] of this.dependencies) {
            this.remove(filePath);
        }
        this.dependencies.clear();
        this.#loadingDependencies.clear();
        this.removeAllListeners();
    }
} 