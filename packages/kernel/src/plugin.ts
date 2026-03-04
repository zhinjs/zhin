/**
 * PluginBase — 轻量级插件基类。
 *
 * 提供 DI (provide/inject)、生命周期 (start/stop)、事件传播 (dispatch/broadcast)、
 * 插件树 (children/parent/root) 和 Feature 支持。
 *
 * 上层框架可继承或组合此类来构建自己的插件系统。
 */
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createHash } from "crypto";
import { createRequire } from "module";
import logger, { Logger } from "@zhin.js/logger";
import { Feature } from "./feature.js";
import type { PluginLike } from "./plugin-types.js";
import { remove, resolveEntry, supportedPluginExtensions } from "./utils.js";
import { AsyncLocalStorage } from "async_hooks";

const require = createRequire(import.meta.url);

// ── AsyncLocalStorage for plugin context ──
export const pluginStorage = new AsyncLocalStorage<PluginBase>();

const loadedModules = new Map<string, PluginBase>();
const contextsKey = Symbol("contexts");
const extensionOwnersKey = Symbol("extensionOwners");

function getFileHash(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return createHash("md5").update(content).digest("hex");
  } catch {
    return "";
  }
}

function watchFile(filePath: string, callback: () => void): () => void {
  try {
    const watcher = fs.watch(filePath, callback);
    watcher.on("error", () => {});
    return () => watcher.close();
  } catch {
    return () => {};
  }
}

/**
 * 通用 Context 接口（kernel 层）
 */
export interface BaseContext<T = unknown> {
  name: string;
  description: string;
  value?: T;
  mounted?: (parent: PluginBase) => T | Promise<T>;
  dispose?: (value: T) => void;
  extensions?: Record<string, Function>;
}

/**
 * 生命周期事件
 */
export interface PluginBaseLifecycle {
  mounted: [];
  dispose: [];
  "context.mounted": [string];
  "context.dispose": [string];
  "before-start": [PluginBase];
  started: [PluginBase];
  [event: string]: unknown[];
}

export type MaybePromise<T> = [T] extends [Promise<infer U>] ? T | U : T | Promise<T>;

export class PluginBase extends EventEmitter<PluginBaseLifecycle> implements PluginLike {
  static [contextsKey] = [] as string[];
  static [extensionOwnersKey] = new Map<string, string>();

  private _cachedName?: string;
  private _explicitName?: string;

  started = false;
  $contexts = new Map<string, BaseContext>();
  children: PluginBase[] = [];
  filePath: string;
  fileHash = "";
  logger: Logger;

  private _disposables = new Set<() => void | Promise<void>>();
  private _featureContributions = new Map<string, Set<string>>();

  constructor(filePath: string = "", public parent?: PluginBase) {
    super();
    this.setMaxListeners(50);
    this.filePath = filePath.replace(/\?t=\d+$/, "");
    this.logger = this.name ? logger.getLogger(this.name) : logger;

    if (parent && !parent.children.includes(this)) {
      parent.children.push(this);
    }
  }

  setName(name: string): void {
    this._explicitName = name;
    this._cachedName = name;
    this.logger = logger.getLogger(name);
  }

  get name(): string {
    if (this._explicitName) return this._explicitName;
    if (this._cachedName) return this._cachedName;

    let name = path
      .relative(process.cwd(), this.filePath)
      .replace(/\?t=\d+$/, "")
      .replace(/\\/g, "/")
      .replace(/\/index\.(js|ts)x?$/, "")
      .replace(/\/(lib|src|dist)$/, "");

    const nodeModulesIndex = name.indexOf("node_modules/");
    if (nodeModulesIndex !== -1) {
      name = name.substring(nodeModulesIndex + "node_modules/".length);
    }
    const lastSlash = name.lastIndexOf("/");
    if (lastSlash !== -1) name = name.substring(lastSlash + 1);
    name = name.replace(/\.(js|ts)x?$/, "");

    this._cachedName = name;
    return this._cachedName;
  }

  get root(): PluginBase {
    if (!this.parent) return this;
    return this.parent.root;
  }

  get contexts(): Map<string, BaseContext> {
    const result = new Map<string, BaseContext>();
    for (const [k, v] of this.$contexts) result.set(k, v);
    for (const child of this.children) {
      for (const [k, v] of child.contexts) result.set(k, v);
    }
    return result;
  }

  inject(name: string): unknown {
    const ctx = this.root.contexts.get(name);
    return ctx?.value;
  }

  provide(target: Feature | BaseContext): this {
    if (target instanceof Feature) {
      const feature = target;
      const ctx: BaseContext = {
        name: feature.name,
        description: feature.desc,
        value: feature,
        mounted: feature.mounted
          ? async (plugin: PluginBase) => {
              await feature.mounted!(plugin);
              return feature;
            }
          : undefined,
        dispose: feature.dispose
          ? async () => { await feature.dispose!(); }
          : undefined,
        extensions: feature.extensions,
      };
      return this.provide(ctx);
    }

    const ctx = target;
    if (!PluginBase[contextsKey].includes(ctx.name)) {
      PluginBase[contextsKey].push(ctx.name);
    }
    this.logger.debug(`Context "${ctx.name}" provided`);

    if (ctx.extensions) {
      for (const [name, fn] of Object.entries(ctx.extensions)) {
        if (typeof fn === "function") {
          Reflect.set(PluginBase.prototype, name, fn);
          PluginBase[extensionOwnersKey].set(name, ctx.name);
        }
      }
    }
    this.$contexts.set(ctx.name, ctx);
    return this;
  }

  async start(t?: number): Promise<void> {
    if (this.started) return;
    this.started = true;

    for (const ctx of this.$contexts.values()) {
      if (typeof ctx.mounted === "function") {
        const result = await ctx.mounted(this);
        if (!ctx.value) ctx.value = result;
      }
      this.emit("context.mounted", ctx.name);
    }
    await this.broadcast("mounted");
    for (const child of this.children) {
      await child.start(t);
    }
    this.logger.debug(`Plugin "${this.name}" ${t ? `reloaded in ${Date.now() - t}ms` : "started"}`);
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    for (const child of this.children) await child.stop();
    this.children = [];

    for (const [name, ctx] of this.$contexts) {
      remove(PluginBase[contextsKey], name);
      if (ctx.extensions) {
        for (const key of Object.keys(ctx.extensions)) {
          if (PluginBase[extensionOwnersKey].get(key) === name) {
            delete (PluginBase.prototype as unknown as Record<string, unknown>)[key];
            PluginBase[extensionOwnersKey].delete(key);
          }
        }
      }
      if (typeof ctx.dispose === "function") {
        await ctx.dispose(ctx.value);
      }
    }
    this.$contexts.clear();
    this._cachedName = undefined;
    this.emit("dispose");

    for (const dispose of this._disposables) {
      try { await dispose(); } catch (e) { this.logger.warn(`Dispose failed: ${e}`); }
    }
    this._disposables.clear();
    this._featureContributions.clear();

    if (this.parent) remove(this.parent.children, this);
    if (this.filePath) {
      try { loadedModules.delete(fs.realpathSync(this.filePath)); } catch {}
    }
    this.removeAllListeners();
  }

  onMounted(callback: () => void | Promise<void>): void {
    this.on("mounted", callback);
  }

  onDispose(callback: () => void | Promise<void>): () => void {
    this._disposables.add(callback);
    return () => { this._disposables.delete(callback); };
  }

  recordFeatureContribution(featureName: string, itemName: string): void {
    if (!this._featureContributions.has(featureName)) {
      this._featureContributions.set(featureName, new Set());
    }
    this._featureContributions.get(featureName)!.add(itemName);
  }

  async dispatch(name: string, ...args: unknown[]): Promise<void> {
    if (this.parent) return this.parent.dispatch(name, ...args);
    return this.broadcast(name, ...args);
  }

  async broadcast(name: string, ...args: unknown[]): Promise<void> {
    const listeners = this.listeners(name) as ((...a: any[]) => any)[];
    for (const listener of listeners) await listener(...args);
    for (const child of this.children) await child.broadcast(name, ...args);
  }

  async import(entry: string, t?: number): Promise<PluginBase> {
    if (!entry) throw new Error(`Plugin entry not found: ${entry}`);
    const resolved = resolveEntry(
      path.isAbsolute(entry) ? entry : path.resolve(path.dirname(this.filePath), entry)
    ) || entry;
    let realPath: string;
    try { realPath = fs.realpathSync(resolved); } catch { realPath = resolved; }

    const normalized = realPath.replace(/\?t=\d+$/, "").replace(/\\/g, "/");
    const existing = this.children.find(
      (c) => c.filePath.replace(/\?t=\d+$/, "").replace(/\\/g, "/") === normalized,
    );
    if (existing) {
      if (this.started && !existing.started) await existing.start(t);
      return existing;
    }

    const plugin = await PluginBase.create(realPath, this);
    if (this.started) await plugin.start(t);
    if (process.env.NODE_ENV === "development") {
      plugin.watch((p) => p.reload());
    }
    return plugin;
  }

  async reload(plugin: PluginBase = this): Promise<void> {
    this.logger.info(`Plugin "${plugin.name}" reloading...`);
    const now = Date.now();
    if (!plugin.parent) return process.exit(51);
    await plugin.stop();
    await plugin.parent.import(plugin.filePath, now);
  }

  watch(callback: (p: PluginBase) => void | Promise<void>, recursive = false): void {
    if (!this.filePath || this.filePath.includes("node_modules")) return;
    const unwatch = watchFile(this.filePath, () => {
      const newHash = getFileHash(this.filePath);
      if (newHash === this.fileHash) return;
      callback(this);
      this.fileHash = newHash;
    });
    this.on("dispose", unwatch);
    if (recursive) for (const child of this.children) child.watch(callback, recursive);
  }

  static async create(entry: string, parent?: PluginBase): Promise<PluginBase> {
    entry = path.resolve(
      path.dirname(parent?.filePath || fileURLToPath(import.meta.url)),
      entry,
    );
    const entryFile = fs.existsSync(entry) ? entry : require.resolve(entry);
    const realPath = fs.realpathSync(entryFile);

    const existing = loadedModules.get(realPath);
    if (existing) return existing;

    const plugin = new PluginBase(realPath, parent);
    plugin.fileHash = getFileHash(entryFile);
    loadedModules.set(realPath, plugin);

    let mod: any;
    await pluginStorage.run(plugin, async () => {
      mod = await import(`${pathToFileURL(entryFile).href}?t=${Date.now()}`);
    });

    if (mod?.pluginName && typeof mod.pluginName === "string") {
      plugin.setName(mod.pluginName);
    }
    return plugin;
  }
}
