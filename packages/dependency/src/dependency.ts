import * as path from 'path';
import { EventEmitter } from 'events';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { Constructor } from './types.js';
import { setCurrentDependency } from './hook-registry.js';
declare global {
  var __CURRENT_DEPENDENCY__: Dependency | null;
}
export const isBun = typeof Bun !== 'undefined'
const childrenKey=Symbol('children');
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
  [childrenKey]: Set<string> = new Set();
  get children(): P[] {
    return Array.from(this[childrenKey]).map(filePath => Dependency.globalDepMap.get(filePath) as P);
  }
  /** 文件路径（私有，可变） */
  #filePath: string;

  /** 获取文件路径 */
  get filePath(): string {
    return this.#filePath;
  }

  /** 引用者列表：所有导入该依赖的模块 */
  public refs: Set<string> = new Set();

  /** 父依赖（getter）：返回 refs 中的第一个元素（首次导入者） */
  get parent(): P | null {
    return this.refs.size > 0 ? Dependency.globalDepMap.get(this.refs.values().next().value!) as P : null;
  }


  /** 是否已启动 */
  started: boolean = false;

  /** 是否已挂载 */
  mounted: boolean = false;


  /** 是否正在重载 */
  reloading: boolean = false;


  /** 全局依赖池：用于依赖去重，key = 绝对路径，value = Dependency 实例 */
  private static globalDepMap = new Map<string, Dependency>();

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
    if(!Dependency.globalDepMap.has(this.#filePath)){}
    await this.mount();
    for (const child of this.children) {
      await child.start();
    }
    this.started = true;

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
    if (!this.started || this.refs.size > 0) {
      return;
    }
    await this.dispatchAsync('before-stop', this);
    await this.emitAsync('self.stop', this);
    await this.dispose();
    Dependency.globalDepMap.delete(this.filePath);
    const absolutePath = this.resolveFilePath(this.#filePath);
    this.removeModuleCache(absolutePath);
    for(const child of this.children){
      await this.removeChild(child);
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
    const savedChildren = [...this.children];
    const parent = this.parent;
    try {
      // 1. 卸载并清理
      await this.#cleanupBeforeReload();

      // 2. 重新导入/启动
      const newNode = await this.#reloadNode();

      // 3. 处理子依赖变化
      await this.#updateChildren(newNode, savedChildren);
      await newNode.start();
      parent?.addChild(newNode);
      return newNode;
    } catch (error) {
      this.#handleReloadError(error);
      return this;
    } finally {
      this.reloading = false;
      await this.dispatchAsync('reloaded', this);
    }
  }
  addChild(child: P): void {
    this[childrenKey].add(child.filePath);
  }

  /**
   * 重载前的清理工作
   */
  async #cleanupBeforeReload(): Promise<void> {
    // 卸载自己
    await this.dispose();
    this.parent?.removeChild(this);
    // 清除模块缓存
    const absolutePath = this.resolveFilePath(this.#filePath);
    this.removeModuleCache(absolutePath);
  }

  /**
   * 重新加载节点
   */
  async #reloadNode(): Promise<Dependency<P>> {
    if (this.isRoot) {
      // 根节点：原地重启
      this.started = false;
      this.#cleanLifecycleListeners();
      // 1. 清空 children，准备重新导入
      this[childrenKey].clear();
      // 2. 重新 start（重新导入模块）
      await this.init();
      return this;
    } else {
      // 有父节点：通过父节点重新导入创建新节点
      const relativePath = this.getRelativePathFromParent(this.parent);
      return await this.parent!.importChild(relativePath) as Dependency<P>;
    }
  }


  #cleanLifecycleListeners(): void {
    const lifecycleEvents = this.eventNames().filter(e => typeof e === 'string' && e.startsWith('self.'));
    for (const event of lifecycleEvents) {
      this.removeAllListeners(event);
    }
    for (const dispose of this.#onSelfDispose) {
      dispose();
    }
    this.#onSelfDispose = [];
  }

  /**
   * 更新子依赖列表
   */
  async #updateChildren(
    newNode: Dependency<P>,
    savedChildren: P[],
  ): Promise<void> {
    // 比较新旧子依赖
    const { removedChildren, addedChildren } = this.#diffChildren(newNode, savedChildren);

    // 停止移除的子依赖
    await this.#removeChildren(savedChildren, removedChildren);

    // 添加新的子依赖
    this.#addChildren(savedChildren, addedChildren);

    // 更新子依赖列表
    newNode[childrenKey].clear();
    for (const child of savedChildren) {
      newNode[childrenKey].add(child.filePath);
    }
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
      await this.removeChild(child);
    }
  }

  /**
   * 添加新的子依赖
   */
  #addChildren(savedChildren: P[], addedChildren: P[]): void {
    for (const child of addedChildren) {
      savedChildren.push(child);
      if (this.isRoot) {
        child.refs.add(this.#filePath);
      }
    }
  }

  /**
   * 处理重载错误
   */
  #handleReloadError(error: unknown): void {
    console.error(error);
    this.dispatch('error', this, error);
    this.dispatch('reload.error', this, error);

    // 恢复错误前的状态
    if (this.parent) {
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
  async init(){
    setCurrentDependency(this);
    const fileUrl = pathToFileURL(this.#filePath).href;
    const importUrl: string = `${fileUrl}?t=${Date.now()}`;
    globalThis.__CURRENT_DEPENDENCY__ = this;
    await import(importUrl);
    Dependency.globalDepMap.set(this.#filePath, this);
    globalThis.__CURRENT_DEPENDENCY__ = null;
    setCurrentDependency(null);
  }
  /**
   * 创建子依赖并启动
   * 这个方法在模块中调用，用于替代普通的 import
   * 
   * 支持继承：子节点会使用与父节点相同的类
   * 支持去重：同一个文件路径只创建一个实例
   */
  async importChild(importPath: string): Promise<P> {
    // 解析相对于当前文件的路径
    const absolutePath = this.resolveImportPath(this.#filePath, importPath);

    // 标准化路径：确保使用实际存在的文件路径
    const normalizedPath = this.resolveFilePath(absolutePath);
    // 检查全局依赖池是否已存在
    let child = Dependency.globalDepMap.get(normalizedPath) as P | undefined;
    if (!child) {
      // 不存在：首次导入，创建新实例
      child = new (this.constructor as Constructor<P>)(normalizedPath);
      await child.init();
    }
    child.refs.add(this.#filePath);
    this[childrenKey].add(child.filePath);
    return child;
  }
  async removeChild(child: P): Promise<void> {
    child.refs.delete(this.#filePath);
    this[childrenKey].delete(child.filePath);
    if(!child.refs.size){
      await child.stop();
    }
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
  get root(): P {
    let current: Dependency = this;
    while (current.parent) {
      current = current.parent;
    }
    return current as P;
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
  get isRoot(): boolean {
    return this.refs.size === 0;
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

    // 显示共享信息：refs.size
    const totalRefs = this.refs.size;
    const sharedMark = totalRefs > 1 ? ` [shared ×${totalRefs}]` : '';

    let result = prefix + `${this.name} (${totalListeners} listeners)${sharedMark}\n`;

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

