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
    readonly #fileWatchers: Map<string, fs.FSWatcher>;  // 文件级监听器
    readonly #logger: Logger;
    readonly #dirs: string[] = [];
    constructor(
        logger: Logger,
    ) {
        super();
        this.#fileWatchers = new Map();
        this.#logger = logger;
    }

    get dirs(){
        return this.#dirs
    }
    set dirs(dirs:string[]){
        this.#dirs.length=0
        for(const dir of dirs){
            this.#dirs.push(resolvePath(dir))
        }
    }
    /** 
     * 监听单个文件（按需监听）
     * @param filePath 文件路径
     * @returns 清理函数
     */
    watchFile(filePath: string): () => void {
        const absPath = resolvePath(filePath);
        
        // 如果已经在监听，返回空函数
        if (this.#fileWatchers.has(absPath)) {
            this.#logger.debug(`File already being watched: ${absPath}`);
            return () => {};
        }
        
        if (!fs.existsSync(absPath)) {
            this.#logger.warn(`File does not exist: ${absPath}`);
            return () => {};
        }
        
        try {
            const watcher = fs.watch(absPath, (eventType) => {
                this.emit('file-change', absPath, eventType);
            });
            
            this.#fileWatchers.set(absPath, watcher);
            this.#logger.debug(`Started watching file: ${path.relative(process.cwd(), absPath)}`);
            
            // 返回清理函数
            return () => {
                this.unwatchFile(absPath);
            };
        } catch (error) {
            this.#logger.error('Failed to watch file', { file: absPath, error });
            return () => {};
        }
    }
    
    /** 
     * 停止监听单个文件
     * @param filePath 文件路径
     */
    unwatchFile(filePath: string): void {
        const absPath = resolvePath(filePath);
        const watcher = this.#fileWatchers.get(absPath);
        
        if (watcher) {
            watcher.close();
            this.#fileWatchers.delete(absPath);
            this.#logger.debug(`Stopped watching file: ${path.relative(process.cwd(), absPath)}`);
        }
    }
    
    watching(filePath:string,callback:()=>void):()=>void{
        const watcher=fs.watch(filePath,{recursive:true},callback)
        return ()=>watcher.close()
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
            // 尝试常见的文件扩展名
            const extensions = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];
            for (const ext of extensions) {
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
        for (const watcher of this.#fileWatchers.values()) {
            watcher.close();
        }
        this.removeAllListeners();
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