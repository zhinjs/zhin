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
const childrenKey = Symbol('children');
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
   * @param hook - 卸载钩子函数
   * @param inner - 是否为内部钩子（在生命周期监听器清理前执行，用于副作用清理）
   */
  addDisposeHook(hook: () => void | Promise<void>, inner: boolean = false): void {
    if (inner) {
      this.#onSelfDispose.push(hook);
    } else {
      this.on('self.dispose', hook);
    }
  }

  /**
   * 启动依赖：导入模块，构建依赖树，然后执行挂载
   */
  async start(force: boolean = false): Promise<void> {
    if (this.started && !force) {
      return;
    }
    await this.dispatchAsync('before-start', this);
    await this.emitAsync('self.start', this);
    await this.mount(force);
    for (const child of this.children) {
      await child.start(force);
    }
    this.started = true;

    await this.dispatchAsync('started', this);
  }

  /**
   * 挂载：执行所有挂载钩子
   */
  async mount(force: boolean = false): Promise<void> {
    if (this.mounted && !force) {
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
      child && await child.broadcastAsync(event, ...args);
    }
  }
  /**
   * 卸载：执行所有卸载钩子
   */
  async dispose(): Promise<void> {
    if (!this.mounted) {
      console.log(`[dispose] ${this.name} - 未挂载，跳过`);
      return;
    }
    console.log(`[dispose] ${this.name} - 开始卸载，#onSelfDispose 数量: ${this.#onSelfDispose.length}`);
    await this.dispatchAsync('before-dispose', this);
    await this.emitAsync('self.dispose', this);
    for (const fn of this.#onSelfDispose) {
      await fn();
    }
    this.mounted = false;
    console.log(`[dispose] ${this.name} - 卸载完成`);
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
    Dependency.globalDepMap.delete(this.filePath);
    const absolutePath = this.resolveFilePath(this.#filePath);
    this.removeModuleCache(absolutePath);
    for (const child of this.children) {
      child && await this.removeChild(child);
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
      console.log(`[reload] ${this.name} - 已在重载中，跳过`);
      return this;
    }
    
    console.log(`\n[reload] ${this.name} - 开始重载 (isRoot: ${this.isRoot})`);
    this.reloading = true;
    await this.dispatchAsync('before-reload', this);
    await this.emitAsync('self.reload', this);
    await this.dispatchAsync('reloading', this);
    const savedChildren = [...this.children];
    console.log(`[reload] ${this.name} - 保存的子依赖:`, savedChildren.map(c => c.name));
    const parent = this.parent;
    try {
      // 1. dispose
      console.log(`[reload] ${this.name} - 1. 执行 dispose`);
      await this.dispose();
      
      // 2. clean cache
      console.log(`[reload] ${this.name} - 2. 清理模块缓存`);
      const absolutePath = this.resolveFilePath(this.#filePath);
      this.removeModuleCache(absolutePath);
      
      // 3. remove from globalDepMap
      console.log(`[reload] ${this.name} - 3. 从全局池删除`);
      Dependency.globalDepMap.delete(this.filePath);
      
      // 4. reload node
      console.log(`[reload] ${this.name} - 4. 重新加载节点`);
      const newNode = await this.#reloadNode();
      console.log(`[reload] ${this.name} - newNode.children:`, newNode.children.map(c => c.name));
      
      // 5. set to globalDepMap
      console.log(`[reload] ${this.name} - 5. 加入全局池`);
      Dependency.globalDepMap.set(newNode.filePath, newNode);

      // 6. update children
      console.log(`[reload] ${this.name} - 6. 更新子依赖`);
      await this.#updateChildren(newNode, savedChildren);
      console.log(`[reload] ${this.name} - 更新后 newNode.children:`, newNode.children.map(c => c.name));
      
      parent && newNode.refs.add(parent.filePath);
      
      console.log(`[reload] ${this.name} - 7. 启动新节点`);
      await newNode.start(this.isRoot);
      console.log(`[reload] ${this.name} - ✅ 重载完成\n`);
      return newNode;
    } catch (error) {
      console.error(`[reload] ${this.name} - ❌ 重载失败:`, error);
      this.#handleReloadError(error);
      return this;
    } finally {
      this.reloading = false;
      await this.dispatchAsync('reloaded', this);
    }
  }

  /**
   * 重新加载节点
   */
  async #reloadNode(): Promise<Dependency<P>> {
    if (this.isRoot) {
      console.log(`[#reloadNode] ${this.name} - 根节点，创建新实例`);
      const newNode = new (this.constructor as Constructor<Dependency<P>>)(this.filePath)
      console.log(`[#reloadNode] ${this.name} - 执行 init()`);
      await newNode.init()
      console.log(`[#reloadNode] ${this.name} - init() 完成，children:`, newNode.children.map(c => c.name));
      return newNode
    } else {
      console.log(`[#reloadNode] ${this.name} - 非根节点，通过父节点导入`);
      return await this.parent!.importChild(this.filePath) as Dependency<P>;
    }
  }

  /**
   * 更新子依赖列表
   */
  async #updateChildren(
    newNode: Dependency<P>,
    savedChildren: P[],
  ): Promise<void> {
    console.log(`[#updateChildren] ${newNode.name} - 开始 Diff`);
    // 比较新旧子依赖
    const { removedChildren, addedChildren } = this.#diffChildren(newNode, savedChildren);
    console.log(`[#updateChildren] ${newNode.name} - removed:`, removedChildren.map(c => c.name));
    console.log(`[#updateChildren] ${newNode.name} - added:`, addedChildren.map(c => c.name));
    console.log(`[#updateChildren] ${newNode.name} - kept:`, savedChildren.filter(c => 
      !removedChildren.includes(c) && !addedChildren.includes(c)
    ).map(c => c.name));

    // 停止移除的子依赖
    await this.#removeChildren(savedChildren, removedChildren);

    // 添加新的子依赖
    this.#addChildren(savedChildren, addedChildren);

    // 更新子依赖列表
    console.log(`[#updateChildren] ${newNode.name} - 更新 childrenKey`);
    newNode[childrenKey].clear();
    for (const child of savedChildren) {
      newNode[childrenKey].add(child.filePath);
      child.refs.add(newNode.filePath);
    }
    console.log(`[#updateChildren] ${newNode.name} - 完成，最终 children:`, savedChildren.map(c => c.name));
  }

  /**
   * 比较新旧子依赖的差异
   */
  #diffChildren(
    newNode: Dependency<P>,
    savedChildren: P[]
  ): { removedChildren: P[]; addedChildren: P[] } {
    const removedChildren = savedChildren.filter(child => {
      return !newNode[childrenKey].has(child.filePath);
    });

    const addedChildren = [...newNode[childrenKey]].filter(child => {
      return !savedChildren.find(c => c.filePath === child);
    }).map(filePath => Dependency.globalDepMap.get(filePath) as P);

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
      Dependency.globalDepMap.set(this.#filePath, this);
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
    this.children.forEach(child => child && child.broadcast(event, ...args));
  }

  async init() {
    console.log(`[init] ${this.name} - 开始初始化模块`);
    setCurrentDependency(this);
    const fileUrl = pathToFileURL(this.#filePath).href;
    const importUrl: string = `${fileUrl}?t=${Date.now()}`;
    console.log(`[init] ${this.name} - 导入 URL:`, importUrl);
    globalThis.__CURRENT_DEPENDENCY__ = this;
    await import(importUrl);
    console.log(`[init] ${this.name} - 模块导入完成，children:`, this.children.map(c => c.name));
    Dependency.globalDepMap.set(this.#filePath, this);
    globalThis.__CURRENT_DEPENDENCY__ = null;
    setCurrentDependency(null);
    console.log(`[init] ${this.name} - 初始化完成`);
  }
  /**
   * 创建子依赖并启动
   * 这个方法在模块中调用，用于替代普通的 import
   * 
   * 支持继承：子节点会使用与父节点相同的类
   * 支持去重：同一个文件路径只创建一个实例
   */
  async importChild(importPath: string, importModulePath = this.#filePath): Promise<P> {
    // 解析相对于当前文件的路径
    const absolutePath = this.resolveImportPath(importModulePath, importPath);

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
    Dependency.globalDepMap.set(child.filePath, child);
    this[childrenKey].add(child.filePath);
    return child;
  }
  async removeChild(child: P): Promise<void> {
    if (child.refs.size === 1) {
      await child.stop();
    }
    child.refs.delete(this.#filePath);
    this[childrenKey].delete(child.filePath);
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
    const events = this.eventNames();
    const totalListeners = events.reduce((sum, event) => sum + this.listenerCount(event), 0);

    // 显示共享信息：refs.size
    const totalRefs = this.refs.size;
    const sharedMark = totalRefs > 1 ? ` [shared ×${totalRefs}]` : '';

    let result = prefix + `${this.name} (${totalListeners} listeners)${sharedMark}\n`;

    const childIndent = isRoot ? '' : indent + (isLast ? '    ' : '│   ');
    this.children.filter(Boolean).forEach((child, index) => {
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
      children: this.children.filter(Boolean).map(child => child.toJSON()),
    };
  }
}

