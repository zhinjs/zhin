import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Logger } from './types.js';
import { resolvePath,isBun } from './utils.js';
/**
 * 文件监听管理器
 * 负责监听目录变化和文件变化检测
 */
export class FileWatcher extends EventEmitter {
    readonly #dirs: string[];
    readonly #dirWatchers: Map<string, fs.FSWatcher>;
    readonly #watchableExtensions: Set<string>;
    readonly #logger: Logger;

    constructor(
        dirs: string[],
        extensions: string[] | Set<string>,
        logger: Logger,
        private exclude:string[]=[path.join(process.cwd(),'node_modules')]
    ) {
        super();
        this.#dirs = dirs.map(dir => resolvePath(dir));
        this.#dirWatchers = new Map();
        this.#watchableExtensions = Array.isArray(extensions) ? new Set(extensions) : extensions;
        this.#logger = logger;
    }

    /** 启动监听 */
    startWatching(): void {
        for (const dir of this.#dirs) {
            this.setupDirWatcher(dir);
        }
    }

    /** 停止监听 */
    stopWatching(): void {
        for (const watcher of this.#dirWatchers.values()) {
            watcher.close();
        }
        this.#dirWatchers.clear();
    }
    watching(filePath:string,callback:()=>void):()=>void{
        const watcher=fs.watch(filePath,{recursive:true},callback)
        return ()=>watcher.close()
    }
    /** 设置目录监听器 */
    private setupDirWatcher(dir: string): void {
        if (this.exclude.includes(dir)||this.#dirWatchers.has(dir)) {
            return;
        }

        if (!fs.existsSync(dir)) {
            this.#logger.warn(`Directory does not exist: ${dir}`);
            return;
        }

        try {
            const listener=(eventType:fs.WatchEventType, filename:string) => {
                if (!filename) return;

                const filePath = path.join(dir, filename);
                
                if (this.isWatchableFile(filePath)) {
                    this.emit('file-change', filePath, eventType);
                }
            }
            const watcher = fs.watch(dir, { recursive: true,persistent:isBun });
            watcher.on('change',listener)
            this.#dirWatchers.set(dir, watcher);
        } catch (error) {
            this.#logger.error('Failed to watch directory', { dir, error });
        }
    }

    /** 检查文件是否可监听 */
    private isWatchableFile(filename: string): boolean {
        const ext = path.extname(filename);
        return this.#watchableExtensions.has(ext);
    }

    /** 添加监听目录 */
    addWatchDir(dir: string): boolean {
        const absDir = resolvePath(dir);
        
        if (this.#dirs.includes(absDir)) {
            this.#logger.warn('Directory already watched', { dir: absDir });
            return false;
        }
        
        if (!fs.existsSync(absDir)) {
            this.#logger.error('Directory does not exist', { dir: absDir });
            return false;
        }
        
        this.#dirs.push(absDir);
        this.setupDirWatcher(absDir);
        
        this.#logger.info('Directory added to watch list', { dir: absDir });
        this.emit('dir-added', absDir);
        
        return true;
    }

    /** 移除监听目录 */
    removeWatchDir(dir: string): boolean {
        const absDir = resolvePath(dir);
        const index = this.#dirs.indexOf(absDir);
        
        if (index === -1) {
            this.#logger.warn('Directory not in watch list', { dir: absDir });
            return false;
        }
        
        const watcher = this.#dirWatchers.get(absDir);
        if (watcher) {
            watcher.close();
            this.#dirWatchers.delete(absDir);
        }
        
        this.#dirs.splice(index, 1);
        
        this.#logger.info('Directory removed from watch list', { dir: absDir });
        this.emit('dir-removed', absDir);
        
        return true;
    }

    /** 获取监听目录列表 */
    getWatchDirs(): ReadonlyArray<string> {
        return [...this.#dirs];
    }

    /** 解析文件路径 */
    resolve(filePath: string): string {
        for (const dir of this.#dirs) {
            const resolvedPath = resolvePath(filePath, dir);
            if(fs.existsSync(resolvedPath)){
                const stat=fs.statSync(resolvedPath)
                if(stat.isFile()) return resolvedPath
                return this.resolve(FileWatcher.getDirDep(resolvedPath))
            }
            for (const ext of this.#watchableExtensions) {
                const fullPath = resolvedPath + ext;
                if (fs.existsSync(fullPath)) {
                    return fullPath;
                }
            }
        }
        throw new Error(`File not found: ${filePath}\n${this.#dirs.join('\n')}`);
    }

    /** 销毁监听器 */
    dispose(): void {
        this.stopWatching();
        this.removeAllListeners();
        this.#dirs.length = 0;
    }
    static getDirDep(filePath:string){
        const pkgPath=path.join(filePath,'package.json')
        const isPkg=fs.existsSync(pkgPath)
        if(isPkg) {
            const {main}=JSON.parse(fs.readFileSync(pkgPath,'utf8'))
            return path.resolve(filePath,main)
        }
        const dirItems=fs.readdirSync(filePath)
        if(dirItems.some(item=>item.startsWith('index.'))) return path.join(filePath,'index')
        throw new Error(`File not found: ${filePath}`);
    }
} 