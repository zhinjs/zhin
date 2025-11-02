import * as path from 'path';
import { EventEmitter } from 'events';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { Constructor } from './types.js';

export const isBun=typeof Bun!=='undefined'
export const isCommonJS=!import.meta?.url?.startsWith('file:')
/**
 * Dependency 类
 * 用于表示项目中的依赖关系，在 import 过程中实时构建依赖树
 * 继承 EventEmitter，支持标准事件机制
 */
export class Dependency<P extends Dependency=Dependency<any>> extends EventEmitter {
  /** 依赖名称 */
  public readonly name: string;

  /** 文件路径（私有，可变） */
  #filePath: string;
  
  /** 获取文件路径 */
  get filePath(): string {
    return this.#filePath;
  }

  /** 父依赖 */
  public parent: P | null = null;

  /** 子依赖 */
  public children: P[] = [];

  /** 是否已启动 */
  private started: boolean = false;

  /** 是否已挂载 */
  private mounted: boolean = false;

  /** 是否正在重载 */
  private reloading: boolean = false;

  /** 已导入的模块缓存（避免循环依赖） */
  private static importedModules: Set<string> = new Set();

  /**
   * 构造函数
   * @param filePath - 文件路径（name 会自动从文件路径中提取）
   */
  constructor(filePath: string) {
    super(); 
    this.#filePath = filePath;
    const basename = path.basename(filePath);
    this.name = path.basename(basename, path.extname(basename));
  }

  /**
   * 添加挂载钩子
   */
  addMountHook(hook: () => void | Promise<void>): void {
    this.on('self.mounted', hook);
  }

  /**
   * 添加卸载钩子
   */
  addDisposeHook(hook: () => void | Promise<void>): void {
    this.on('self.disposed', hook);
  }

  /**
   * 启动依赖：导入模块，构建依赖树，然后执行挂载
   */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.dispatch('beforeStart', this);

    this.#filePath= this.resolveFilePath(this.#filePath);

    if (Dependency.importedModules.has(this.#filePath)) {
      this.started = true;
      return;
    }
    Dependency.importedModules.add(this.#filePath);

    const { setCurrentDependency } = await import('./hook-registry.js');

    setCurrentDependency(this);

    try {
      const fileUrl = pathToFileURL(this.#filePath).href;
      const importUrl: string=`${fileUrl}?t=${Date.now()}`;
      await import(importUrl);
      
      // 导入成功后，检查并更新为实际的源文件路径
      // 在不同环境下，可能是 .js 或 .ts
      if (this.#filePath.endsWith('.js')) {
        // 尝试查找对应的 .ts 文件
        let tsPath = this.#filePath.replace(/\.js$/, '.ts');
        if (fs.existsSync(tsPath)) {
          this.#filePath = tsPath;
        }
      }
    } catch (error) {
      console.warn(`Failed to import module: ${this.#filePath}`, error);
      this.dispatch('error',this, error);
    } finally {
      setCurrentDependency(null);
      this.started = true;
    }

    this.dispatch('afterStart', this);

    await this.mount();
  }

  /**
   * 挂载：执行所有挂载钩子
   */
  async mount(): Promise<void> {
    if (this.mounted) {
      return;
    }
    
    this.dispatch('beforeMount', this);

    await this.emitAsync('self.mounted', this);

    this.mounted = true;

    await this.dispatchAsync('afterMount', this);
    await this.dispatchAsync('mounted', this); // 向后兼容
  }
  async emitAsync(event: string, ...args: any[]): Promise<void> {
    const listeners = this.listeners(event);
    await Promise.allSettled(listeners.map(listener => Promise.resolve(listener(...args))));
  }
  async dispatchAsync(event: string, ...args: any[]): Promise<void> {
    if(this.parent) await this.parent.dispatchAsync(event, ...args);
    else await this.broadcastAsync(event, ...args);
  }
  async broadcastAsync(event: string, ...args: any[]): Promise<void> {
    this.emitAsync(event, ...args);
    for(const child of this.children) {
      await child.broadcastAsync(event, ...args);
    }
  }
  /**
   * 卸载：执行所有卸载钩子
   */
  async dispose(): Promise<void> {
    if (!this.mounted) {
      return;
    }

    await this.dispatchAsync('beforeDispose', this);

    await this.emitAsync('self.disposed', this);

    this.mounted = false;

    await this.dispatchAsync('afterDispose', this);
    await this.dispatchAsync('disposed', this); // 向后兼容
  }

  /**
   * 停止：卸载自己，然后级联停止所有子依赖
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.dispose();

    for (let i = this.children.length - 1; i >= 0; i--) {
      await this.children[i].stop();
    }

    this.started = false;
  }


  /**
   * 重新加载文件
   * 1. 暂存当前节点的 children
   * 2. 从父节点移除当前节点
   * 3. 父节点重新导入该文件
   * 4. 将暂存的 children 赋值到新节点
   * 5. 更新暂存 children 的 parent 为新节点
   */
  async reload(): Promise<Dependency> {
    if (this.reloading) {
      return this;
    }

    this.reloading = true;

    try {

      // 发出 beforeReload 事件
      this.dispatch('beforeReload',this);

      // 1. 暂存当前节点的 children
      const savedChildren = [...this.children];

      // 3. 先卸载自己
      await this.dispose();

      // 4. 从父节点的 children 中移除自己
      const parent = this.parent;
      const indexInParent = parent?.children.indexOf(this) ?? -1;
      if (indexInParent && indexInParent !== -1) {
        parent?.children.splice(indexInParent, 1);
      }

      // 5. 清除模块缓存，允许重新导入
      // this.filePath 现在已经是实际的源文件路径（.ts）
      const absolutePath = this.resolveFilePath(this.#filePath);
      
      Dependency.importedModules.delete(absolutePath);
      // 同时清除可能的 .js 路径
      const jsPath = absolutePath.replace(/\.ts$/, '.js');
      Dependency.importedModules.delete(jsPath);
      
      this.removeModuleCache(absolutePath);
      
      // 6. 父节点重新导入该文件（会创建新的 Dependency 节点）
      const relativePath = this.getRelativePathFromParent(parent);
      const newNode = await parent?.importChild(relativePath)||new (this.constructor as typeof Dependency)(this.#filePath);

      if(!parent) await newNode.start();

      // 7. 将暂存的 children 赋值到新节点
      newNode.children = savedChildren;

      // 8. 更新暂存 children 的 parent 为新节点
      for (const child of savedChildren) {
        child.parent = newNode;
      }


      // 发出 afterReload 事件
      newNode.dispatch('afterReload', newNode);
      newNode.dispatch('reloaded', newNode); // 向后兼容
      return newNode;
    } catch (error) {
      this.dispatch('error',this, error);
      this.dispatch('reloadError',this, error);
      return this;
    } finally {
      this.reloading = false;
    }
  }

  private removeModuleCache(filePath: string): void {
    // 清除 require.cache（仅在 CommonJS 环境下存在）
    if (typeof require !== 'undefined' && require.cache) {
      if (require.cache[filePath]) {
        delete require.cache[filePath];
      }
    }
    
    // @ts-ignore
    if (typeof import.meta.cache !== 'undefined') {
      // @ts-ignore
      if (import.meta.cache[filePath]) {
        // @ts-ignore
        delete import.meta.cache[filePath];
      }
    }
  }

  dispatch(event: string, ...args: any[]): void {
    if (this.parent) return this.parent.dispatch(event, ...args);
    return this.broadcast(event, ...args);
  }

  broadcast(event: string, ...args: any[]): void {
    // 对 'error' 事件特殊处理：如果没有监听器，输出到 console.error
    if (event === 'error' && this.listenerCount('error') === 0) {
      const [, error] = args;
      console.error(`[${this.name}] Unhandled error:`, error);
    } else {
      this.emit(event, ...args);
    }
    this.children.forEach(child => child.broadcast(event, ...args));
  }

  /**
   * 获取相对于父节点的导入路径
   */
  private getRelativePathFromParent(parent: Dependency | null): string {
    if (!parent) {
      return this.#filePath;
    }
    const parentDir = path.dirname(parent.#filePath);
    const currentPath = this.#filePath;
    let relativePath = path.relative(parentDir, currentPath);

    if (!relativePath.startsWith('.')) {
      relativePath = './' + relativePath;
    }

    if (relativePath.endsWith('.js')) {
      relativePath = relativePath.slice(0, -3);
    }

    return relativePath;
  }

  /**
   * 创建子依赖并启动
   * 这个方法在模块中调用，用于替代普通的 import
   * 
   * 支持继承：子节点会使用与父节点相同的类
   */
  async importChild(importPath: string): Promise<Dependency> {
    // 解析相对于当前文件的路径
    const absolutePath = this.resolveImportPath(this.#filePath, importPath);
    
    // 使用 this.constructor 创建同类型的实例，支持继承
    const child = new (this.constructor as Constructor<P>)(absolutePath);
    child.parent = this;
    this.children.push(child);
    await child.start();
    return child;
  }

  /**
   * 解析文件路径
   */
  private resolveFilePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(process.cwd(), filePath);
  }

  /**
   * 解析 import 路径（相对于当前文件）
   */
  private resolveImportPath(currentFile: string, importPath: string): string {
    const currentDir = path.dirname(this.resolveFilePath(currentFile));

    // 处理相对路径
    if (importPath.startsWith('.')) {
      let resolved = path.resolve(currentDir, importPath);

      // 如果没有扩展名，尝试添加
      if (!path.extname(resolved)) {
        // 根据当前文件的扩展名决定添加什么扩展名
        const currentExt = path.extname(currentFile);
        if (currentExt === '.ts') {
          resolved = resolved + '.ts';
        } else {
          resolved = resolved + '.js';
        }
      }

      return resolved;
    }

    // 处理 node_modules 中的包
    return importPath;
  }

  /**
   * 获取根依赖
   */
  getRoot(): Dependency {
    let current: Dependency = this;
    while (current.parent) {
      current = current.parent;
    }
    return current;
  }

  /**
   * 获取从根到当前节点的路径
   */
  getPath(): Dependency[] {
    const path: Dependency[] = [];
    let current: Dependency | null = this;
    while (current) {
      path.unshift(current);
      current = current.parent;
    }
    return path;
  }

  /**
   * 获取当前节点的深度（根节点深度为 0）
   */
  getDepth(): number {
    let depth = 0;
    let current: Dependency | null = this.parent;
    while (current) {
      depth++;
      current = current.parent;
    }
    return depth;
  }

  /**
   * 检查是否为根节点
   */
  isRoot(): boolean {
    return this.parent === null;
  }

  /**
   * 获取依赖信息的字符串表示
   */
  toString(): string {
    return `Dependency { name: "${this.name}", filePath: "${this.#filePath}", children: ${this.children.length} }`;
  }

  /**
   * 以树形结构打印依赖
   */
  printTree(indent: string = '', isLast: boolean = true, isRoot: boolean = false): string {
    const prefix = isRoot ? '' : indent + (isLast ? '└── ' : '├── ');
    const events = this.eventNames().filter(e =>
      typeof e === 'string' &&
      !['beforeStart', 'afterStart', 'beforeMount', 'afterMount', 'mounted', 'beforeDispose', 'afterDispose', 'disposed', 'beforeReload', 'afterReload', 'reloaded', 'error', 'fileChange', 'reloadError'].includes(e)
    );
    const totalListeners = events.reduce((sum, event) => sum + this.listenerCount(event), 0);
    let result = prefix + `${this.name} (${totalListeners} listeners)\n`;

    const childIndent = isRoot ? '' : indent + (isLast ? '    ' : '│   ');
    this.children.forEach((child, index) => {
      const childIsLast = index === this.children.length - 1;
      result += child.printTree(childIndent, childIsLast, false);
    });

    return result;
  }

  /**
   * 获取依赖信息的 JSON 表示
   */
  toJSON(): object {
    const events = this.eventNames().filter(e =>
      typeof e === 'string' &&
      !['beforeStart', 'afterStart', 'beforeMount', 'afterMount', 'mounted', 'beforeDispose', 'afterDispose', 'disposed', 'beforeReload', 'afterReload', 'reloaded', 'error', 'fileChange', 'reloadError'].includes(e)
    );
    const listeners = Object.fromEntries(
      events.map(event => [event.toString(), this.listenerCount(event)])
    );

    return {
      name: this.name,
      filePath: this.#filePath,
      listeners,
      children: this.children.map(child => child.toJSON()),
    };
  }
}

