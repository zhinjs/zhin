import { Dict, getPackageInfo, remove } from "@zhinjs/shared";
import { Dispose } from "@/dispose";
import { Context } from "@/context";
import { Zhin } from "@/zhin";
import { NSession } from "@/session";

export interface Plugin {
    context: Context;
}

export class PluginMap extends Map<string, Plugin> {
    get builtList() {
        return [...this.values()].filter(plugin => {
            return plugin.type === Plugin.Source.built;
        });
    }

    get localList() {
        return [...this.values()].filter(plugin => {
            return plugin.type === Plugin.Source.local;
        });
    }

    get communityList() {
        return [...this.values()].filter(plugin => {
            return plugin.type === Plugin.Source.community;
        });
    }

    get officialList() {
        return [...this.values()].filter(plugin => {
            return plugin.type === Plugin.Source.official;
        });
    }

    get npmList() {
        return [].concat(this.communityList, this.officialList);
    }
}

export class Plugin {
    public name: string;
    // 可用状态
    public status: boolean;
    public dependencies: string[] = [];
    public disableBots: `${keyof Zhin.Adapters}:${string | number}`[] = [];

    constructor(
        public options: Plugin.Options,
        public info: Plugin.Info,
    ) {
        this.name = options.name;
        this.status = true;
    }

    // 插件类型
    get type() {
        return this.options.type;
    }

    // 插件是否启用指定机器人
    match<P extends keyof Zhin.Adapters>(session: NSession<P>) {
        const flag: `${keyof Zhin.Adapters}:${
            | string
            | number}` = `${session.protocol}:${session.bot.self_id}`;
        return (
            !this.disableBots.includes(flag) &&
            (this.options.scopes === undefined ||
                this.options.scopes.length === 0 ||
                this.options.scopes.includes(session.protocol))
        );
    }

    // 根据指定配置挂载插件
    mount(ctx: Context) {
        this.context = ctx;
        ctx[Context.plugin] = this;
        const result = this.options.install.call(this, ctx);

        this.dependencies = this.initDependencies(this.options.fullPath);
        if (result && typeof result === "function") {
            const dispose = () => {
                result();
                remove(ctx.disposes, dispose);
            };
            ctx.disposes.push(dispose);
        }
    }

    reLoad() {
        if (!this.context.parent) {
            this.context?.zhin?.logger.warn("未载入插件无法重载");
            return;
        }
        const parent = this.context.parent;
        this.unmount();
        const newPlugin = parent.zhin.load(
            this.options.fullPath,
            "plugin",
            this.options.setup,
        );
        parent.plugin(newPlugin);
        parent.logger.info(`已重载插件:${newPlugin.name}`);
    }

    private initDependencies(filePath: string) {
        if (!require.cache[filePath]) return [];
        return [filePath]
            .concat(
                (require.cache[filePath].children || []).map(
                    mod => mod.filename,
                ),
            )
            .filter(filePath => {
                return (
                    !filePath.includes("node_modules") &&
                    !this.context.zhin.pluginList
                        .filter(p => p !== this)
                        .map(p => p.options.fullPath)
                        .includes(filePath)
                );
            });
    }

    // 卸载插件
    unmount() {
        this.context?.zhin.emit("plugin-remove", this);
        this.context?.parent.plugins.delete(this.options.fullName);
        this.context?.logger.debug(`已卸载插件:${this.name}`);
        this.context?.dispose();
    }

    // 禁用插件
    enable(): boolean;
    enable<P extends keyof Zhin.Adapters>(bot: Zhin.Bots[P]): this;
    enable<P extends keyof Zhin.Adapters>(bot?: Zhin.Bots[P]): boolean | this {
        if (!bot) return (this.status = true);
        if (
            !this.disableBots.includes(`${bot.adapter.protocol}:${bot.self_id}`)
        ) {
            this.context?.logger.warn(`插件未被禁用:${this.name}`);
            return this;
        }
        remove(this.disableBots, `${bot.adapter.protocol}:${bot.self_id}`);
        this.context.zhin.emit("plugin-enable", this.options.fullName);
        return this;
    }

    // 启用插件
    disable(): boolean;
    disable<P extends keyof Zhin.Adapters>(bot: Zhin.Bots[P]): this;
    disable<P extends keyof Zhin.Adapters>(bot?: Zhin.Bots[P]): boolean | this {
        if (!bot) return (this.status = false);
        if (
            this.disableBots.includes(`${bot.adapter.protocol}:${bot.self_id}`)
        ) {
            this.context?.logger.warn(`重复禁用插件:${this.name}`);
            return this;
        }
        this.disableBots.push(`${bot.adapter.protocol}:${bot.self_id}`);
        this.context.zhin.emit("plugin-disable", this.options.fullName);
        return this;
    }
}

export namespace Plugin {
    export type InstallFunction = (parent: Context) => void | Dispose;

    export interface InstallObject {
        name?: string;
        install: InstallFunction;
    }

    export function defineOptions(options: Install): Options {
        const baseOption: Omit<Options, "install"> = {
            setup: false,
            anonymous: false,
            functional: false,
            anonymousCount: 0,
        };
        return typeof options === "function"
            ? {
                  ...baseOption,
                  name: options.name || "anonymousPlugin",
                  fullName: `${
                      options.name || "anonymousPlugin"
                  }:${Date.now()}`,
                  anonymous: options.prototype === undefined,
                  functional: true,
                  install: options,
              }
            : {
                  ...baseOption,
                  name: options.name || "localPlugin",
                  fullName: `${options.name || "localPlugin"}:${Date.now()}`,
                  functional: false,
                  ...options,
              };
    }

    export type Install = InstallFunction | InstallObject;

    export interface Info {
        version?: string;
        type?: string;
        desc?: string;
        author?: string | { name: string; email?: string };
    }

    export function getInfo(pluginPath: string): Info {
        if (!pluginPath) return {};
        return getPackageInfo(pluginPath);
    }

    export enum Source {
        built = "built",
        local = "local",
        community = "community",
        official = "official",
    }

    export type Options<T = any> = InstallObject & {
        type?: Source;
        enable?: boolean;
        scopes?: (keyof Zhin.Adapters)[];
        using?: (keyof Zhin.Services)[];
        setup?: boolean;
        anonymous?: boolean;
        anonymousCount?: number;
        functional?: boolean;
        fullName?: string;
        fullPath?: string;
    };
    type AuthorInfo = {
        username: string;
        email: string;
    };

    export interface Package {
        name: string;
        scope: string;
        version: string;
        description: string;
        keywords: string[];
        date: string;
        links: Dict<string>;
        publisher: AuthorInfo;
        maintainers: AuthorInfo[];
    }
}
