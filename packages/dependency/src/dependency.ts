import * as path from 'path';
import { EventEmitter } from 'events';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { Constructor } from './types.js';

export const isBun = typeof Bun !== 'undefined'
export const isCommonJS = !import.meta?.url?.startsWith('file:');
/**
 * Dependency 类
 * 用于表示项目中的依赖关系，在 import 过程中实时构建依赖树
 * 继承 EventEmitter，支持标准事件机制
 */
export class Dependency<P extends Dependency = Dependency<any>> extends EventEmitter {
  /** 依赖名称 */
  public readonly name: string;
  #onSelfDispose: Function[] = [];
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
  started: boolean = false;

  /** 是否已挂载 */
  mounted: boolean = false;


  /** 是否正在重载 */
  reloading: boolean = false;

  /** 已导入的模块缓存（避免循环依赖） */
  private static importedModules: Set<string> = new Set();

  /**
   * 构造函数
   * @param filePath - 文件路径（name 会自动从文件路径中提取）
   */
  constructor(filePath: string) {
    super();
    this.#filePath = this.resolveFilePath(filePath);
    const basename = path.basename(this.#filePath);
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
  addDisposeHook(hook: () => void | Promise<void>, inner: boolean = false): void {
    if (inner) this.#onSelfDispose.push(hook);
    else this.on('self.dispose', hook);
  }

  /**
   * 启动依赖：导入模块，构建依赖树，然后执行挂载
   */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    await this.dispatchAsync('before-start', this);
    await this.emitAsync('self.start', this);

    if (Dependency.importedModules.has(this.#filePath)) {
      this.started = true;
      await this.dispatchAsync('started', this);
      return;
    }
    Dependency.importedModules.add(this.#filePath);

    const { setCurrentDependency } = await import('./hook-registry.js');

    setCurrentDependency(this);

    try {
      const fileUrl = pathToFileURL(this.#filePath).href;
      const importUrl: string = `${fileUrl}?t=${Date.now()}`;
      await import(importUrl);
      for (const child of this.children) {
        await child.start();
      }
    } catch (error) {
      console.warn(`Failed to import module: ${this.#filePath}`, error);
      this.dispatch('error', this, error);
    } finally {
      setCurrentDependency(null);
      this.started = true;
    }


    await this.mount();
    await this.dispatchAsync('started', this);
  }

  /**
   * 挂载：执行所有挂载钩子
   */
  async mount(): Promise<void> {
    if (this.mounted) {
      return;
    }

    await this.dispatchAsync('before-mount', this);

    await this.emitAsync('self.mounted', this);

    this.mounted = true;

    await this.dispatchAsync('mounted', this);
  }
  async emitAsync(event: string, ...args: any[]): Promise<void> {
    const listeners = this.listeners(event);
    await Promise.allSettled(listeners.map(listener => listener(...args)));
  }
  async dispatchAsync(event: string, ...args: any[]): Promise<void> {
    if (this.parent) await this.parent.dispatchAsync(event, ...args);
    else await this.broadcastAsync(event, ...args);
  }
  async broadcastAsync(event: string, ...args: any[]): Promise<void> {
    await this.emitAsync(event, ...args);
    for (const child of this.children) {
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
    await this.dispatchAsync('before-dispose', this);
    await this.emitAsync('self.dispose', this);
    for (const dispose of this.#onSelfDispose) {
      dispose();
    }
    this.mounted = false;
    await this.dispatchAsync('disposed', this);
  }

  /**
   * 停止：卸载自己，然后级联停止所有子依赖
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    await this.dispatchAsync('before-stop', this);
    await this.emitAsync('self.stop', this);
    await this.dispose();

    const absolutePath = this.resolveFilePath(this.#filePath);
    Dependency.importedModules.delete(absolutePath);
    this.removeModuleCache(absolutePath);
    for (let i = this.children.length - 1; i >= 0; i--) {
      await this.children[i].stop();
    }
    await this.dispatchAsync('stopped', this);
    this.started = false;
  }

  /**
   * 重新加载依赖
   * 
   * 对于有父节点的依赖：创建新节点替换旧节点
   * 对于根节点：原地重启，保持引用不变
   */
  async reload(): Promise<Dependency> {
    if (this.reloading) {
      return this;
    }
    
    this.reloading = true;
    await this.dispatchAsync('before-reload', this);
    await this.emitAsync('self.reload', this);
    await this.dispatchAsync('reloading', this);
    
    const isRoot = !this.parent;
    const savedSelf = this.parent?.children.find(c => c.filePath === this.filePath) || this;
    const savedChildren = [...savedSelf.children];

    try {
      // 1. 卸载并清理
      await this.#cleanupBeforeReload(savedSelf);
      
      // 2. 重新导入/启动
      const newNode = await this.#reloadNode(isRoot);
      
      // 3. 处理子依赖变化
      await this.#updateChildren(newNode, savedChildren, isRoot);
      
      // 4. 启动新节点（非根节点）
      if (!isRoot) {
        await newNode.start();
      }
      
      return newNode;
    } catch (error) {
      this.#handleReloadError(error, savedSelf);
      return this;
    } finally {
      this.reloading = false;
      await this.dispatchAsync('reloaded', this);
    }
  }

  /**
   * 重载前的清理工作
   */
  async #cleanupBeforeReload(savedSelf: Dependency | null): Promise<void> {
    // 卸载自己
    await this.dispose();
    
    // 从父节点移除（非根节点）
    if (savedSelf && this.parent) {
      this.parent.children.splice(this.parent.children.indexOf(savedSelf), 1);
    }
    
    // 清除模块缓存
    const absolutePath = this.resolveFilePath(this.#filePath);
    Dependency.importedModules.delete(absolutePath);
    this.removeModuleCache(absolutePath);
  }

  /**
   * 重新加载节点
   */
  async #reloadNode(isRoot: boolean): Promise<Dependency<P>> {
    if (isRoot) {
      // 根节点：原地重启
      this.started = false;
      this.#cleanLifecycleListeners();
      this.children = [];
      await this.start();
      return this;
    } else {
      // 有父节点：通过父节点重新导入创建新节点
      const relativePath = this.getRelativePathFromParent(this.parent);
      return await this.parent!.importChild(relativePath) as Dependency<P>;
    }
  }

  #cleanLifecycleListeners(): void {
    const lifecycleEvents = this.eventNames().filter(e => typeof e === 'string' && e.startsWith('self.'));
    for(const event of lifecycleEvents){
      this.removeAllListeners(event);
    }
    this.#onSelfDispose = [];
  }

  /**
   * 更新子依赖列表
   */
  async #updateChildren(
    newNode: Dependency<P>,
    savedChildren: P[],
    isRoot: boolean
  ): Promise<void> {
    // 比较新旧子依赖
    const { removedChildren, addedChildren } = this.#diffChildren(newNode, savedChildren);
    
    // 停止移除的子依赖
    await this.#removeChildren(savedChildren, removedChildren);
    
    // 添加新的子依赖
    this.#addChildren(savedChildren, addedChildren, isRoot);
    
    // 更新子依赖列表
    newNode.children = savedChildren;
  }

  /**
   * 比较新旧子依赖的差异
   */
  #diffChildren(
    newNode: Dependency<P>,
    savedChildren: P[]
  ): { removedChildren: P[]; addedChildren: P[] } {
    const removedChildren = savedChildren.filter(child => {
      return !newNode.children.find(c => c.filePath === child.filePath);
    });
    
    const addedChildren = newNode.children.filter(child => {
      return !savedChildren.find(c => c.filePath === child.filePath);
    }) as P[];
    
    return { removedChildren, addedChildren };
  }

  /**
   * 移除不再需要的子依赖
   */
  async #removeChildren(savedChildren: P[], removedChildren: P[]): Promise<void> {
    for (const child of removedChildren) {
      savedChildren.splice(savedChildren.indexOf(child), 1);
      this.removeModuleCache(child.filePath);
      await child.stop();
    }
  }

  /**
   * 添加新的子依赖
   */
  #addChildren(savedChildren: P[], addedChildren: P[], isRoot: boolean): void {
    for (const child of addedChildren) {
      savedChildren.push(child);
      if (isRoot) {
        child.parent = this;
      }
    }
  }

  /**
   * 处理重载错误
   */
  #handleReloadError(error: unknown, savedSelf: Dependency | null): void {
    this.dispatch('error', this, error);
    this.dispatch('reload.error', this, error);
    
    // 恢复错误前的状态
    if (savedSelf && this.parent) {
      this.parent.children.splice(
        this.parent.children.findIndex(c => c.filePath === this.#filePath),
        1,
        this
      );
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
    const extname = path.extname(this.#filePath);
    const currentPath = this.#filePath;
    let relativePath = path.relative(parentDir, currentPath);

    if (!relativePath.startsWith('.')) {
      relativePath = './' + relativePath;
    }

    return relativePath.replace(extname, '');
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
    if (this.started) await child.start();
    return child;
  }

  /**
   * 解析文件路径
   */
  private resolveFilePath(filePath: string): string {
    const removeExt = (input: string) => input.replace(path.extname(input), '');
    const removeExtAfter = removeExt(filePath);
    const maybeFiles = [
      removeExtAfter + '.js',
      removeExtAfter + '.ts',
      removeExtAfter + '.mjs',
      removeExtAfter + '.cjs',
      filePath,
      removeExtAfter
    ]
    return maybeFiles.find(file => fs.existsSync(file)) || filePath;
  }

  /**
   * 解析 import 路径（相对于当前文件）
   */
  private resolveImportPath(currentFile: string, importPath: string): string {
    const currentDir = path.dirname(this.resolveFilePath(currentFile));

    // 处理相对路径
    if (importPath.startsWith('.')) {
      let resolved = path.resolve(currentDir, importPath);
      const extname = path.extname(resolved);
      return resolved.replace(extname, '');
    }
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
      !['before-start', 'started', 'before-mount', 'mounted', 'before-dispose', 'disposed', 'before-reload', 'reloading', 'reloaded', 'error', 'fileChange', 'reload.error'].includes(e)
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
    const listeners = Object.fromEntries(
      this.eventNames().map(event => [event.toString(), this.listenerCount(event)])
    );

    return {
      name: this.name,
      filePath: this.#filePath,
      listeners,
      children: this.children.map(child => child.toJSON()),
    };
  }
}

