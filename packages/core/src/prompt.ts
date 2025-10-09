import {AdapterMessage, Dict, RegisteredAdapter} from './types.js';
import { MessageMiddleware,Plugin } from './plugin.js';
import { Message } from './message.js';
import { Schema } from './schema.js';

/**
 * Prompt类：用于实现机器人与用户的交互式提问与输入收集。
 * 支持文本、数字、确认、列表、选项、Schema等多种输入类型，自动处理超时、默认值、格式化等。
 * 典型用法：await new Prompt(plugin, event).text('请输入内容')
 * @template P 适配器类型
 */
export class Prompt<P extends RegisteredAdapter> {
    /**
     * 构造函数
     * @param plugin 所属插件实例
     * @param event 当前消息事件
     */
    constructor(private plugin:Plugin,private event: Message<AdapterMessage<P>>) {}
    /**
     * 获取当前会话唯一标识（适配器-机器人-频道-用户）
     */
    private getChannelAddress<P2 extends RegisteredAdapter>(event: Message<AdapterMessage<P2>>) {
        return `${event.$adapter}-${event.$bot}-${event.$channel.type}:${event.$channel.id}-${event.$sender.id}`;
    }
    /**
     * 通用提问方法，支持自定义格式化、超时、默认值等
     * @param config 提问配置
     */
    private prompt<T = any>(config: Prompt.Config<T>) {
        return new Promise<T>((resolve, reject) => {
            this.event.$reply(config.tips);
            this.middleware(
                input => {
                    if (input instanceof Error) {
                        this.event.$reply(input.message);
                        if (config.defaultValue) resolve(config.defaultValue);
                        else reject(input);
                        return;
                    }
                    resolve(config.format(input));
                },
                config.timeout,
                config.timeoutText,
            );
        });
    }
    /**
     * 注册一次性消息中间件，等待用户输入或超时
     * @param callback 输入回调
     * @param timeout 超时时间（默认3分钟）
     * @param timeoutText 超时提示
     */
    middleware(callback: (input: string | Error) => any, timeout: number = 3 * 60 * 1000, timeoutText = '输入超时') {
        const middleware: MessageMiddleware<P> = (event, next) => {
            if (this.getChannelAddress<P>(event) !== this.getChannelAddress<P>(this.event)) return next();
            callback(event.$raw);
            dispose();
            clearTimeout(timer);
        };
        const dispose = this.plugin.addMiddleware(middleware);
        const timer = setTimeout(() => {
            dispose();
            callback(new Error(timeoutText));
        }, timeout);
    }
    /**
     * 文本输入
     */
    async text(tips: string, timeout?: number, defaultValue = '', timeoutText?: string): Promise<string> {
        return this.prompt<string>({
            tips,
            defaultValue,
            timeoutText,
            timeout,
            format: (input: string) => input,
        });
    }
    /**
     * 任意输入
     */
    async any(tips: string, timeout?: number, defaultValue = '', timeoutText?: string) {
        return this.prompt<string>({
            tips,
            defaultValue,
            timeoutText,
            timeout,
            format: (input: string) => input,
        });
    }
    /**
     * 数字输入
     */
    async number(tips: string, timeout?: number, defaultValue = 0, timeoutText?: string): Promise<number> {
        return this.prompt<number>({
            tips,
            defaultValue,
            timeoutText,
            timeout,
            format: (input: string) => +input,
        });
    }
    /**
     * 确认输入（如 yes/no）
     */
    async confirm(
        tips: string,
        condition: string = 'yes',
        timeout?: number,
        defaultValue = false,
        timeoutText?: string,
    ): Promise<boolean> {
        return this.prompt<boolean>({
            tips: `${tips}\n输入“${condition}”以确认`,
            defaultValue,
            timeout,
            timeoutText,
            format: (input: string) => input === condition,
        });
    }
    /**
     * 列表输入，支持多值分隔
     */
    async list<T extends Prompt.SingleType = 'text'>(
        tips: string,
        config: Prompt.ListConfig<T> = { type: 'text' as T },
        timeoutText?: string,
    ): Promise<Prompt.Result<T>[]> {
        const separator = config.separator || ',';
        return this.prompt<Prompt.Result<T>[]>({
            tips: `${tips}\n值之间使用“${separator}”分隔`,
            defaultValue: config.defaultValue || [],
            timeout: config.timeout,
            timeoutText,
            format: (input: string) =>
                input.split(separator).map(v => {
                    switch (config.type) {
                        case 'boolean':
                            return Boolean(v);
                        case 'number':
                            return +v;
                        case 'text':
                            return v;
                    }
                }) as Prompt.Result<T>[],
        });
    }
    /**
     * 返回常量值（用于Schema）
     */
    async const<T = any>(value: T): Promise<T> {
        return value;
    }
    /**
     * 选项选择，支持单选/多选
     */
    async pick<T extends Prompt.SingleType, M extends boolean = false>(
        tips: string,
        config: Prompt.PickConfig<T, M>,
        timeoutText?: string,
    ): Promise<Prompt.PickResult<T, M>> {
        const moreTextArr = config.options.map((o, idx) => {
            return `${idx + 1}.${o.label}`;
        });
        const separator = config.separator || ',';
        if (config.multiple) moreTextArr.push(`多选请用“${separator}”分隔`);
        return this.prompt<Prompt.PickResult<T, M>>({
            tips: `${tips}\n${moreTextArr.join('\n')}`,
            defaultValue: config.defaultValue,
            timeout: config.timeout,
            timeoutText,
            format: (input: string) => {
                if (!config.multiple)
                    return config.options.find((o, idx) => {
                        return idx + 1 === +input;
                    })?.value as Prompt.PickResult<T, M>;
                const pickIdx = input.split(separator).map(Number);
                return config.options
                    .filter((o, idx) => {
                        return pickIdx.includes(idx + 1);
                    })
                    .map(o => o.value) as Prompt.PickResult<T, M>;
            },
        });
    }
    /**
     * 基于Schema的选项选择
     */
    async pickValueWithSchema<T extends Schema>(schema: T): Promise<Schema.Types<T>> {
        return this.pick(schema.meta.description, {
            type: '' as any,
            options: schema.meta.options!.map(o => ({
                label: o.label,
                value: o.value,
            })),
            multiple: schema.meta.multiple,
            defaultValue: schema.meta.default,
        });
    }
    /**
     * 批量Schema输入
     */
    async getValueWithSchemas<T extends Record<string, Schema>>(schemas: T): Promise<Schema.RecordTypes<T>> {
        const result: Dict = {};
        for (const key of Object.keys(schemas)) {
            const schema = schemas[key];
            result[key] = await this.getValueWithSchema(schema);
        }
        return result as Schema.RecordTypes<T>;
    }
    /**
     * 单个Schema输入，自动分发到不同类型
     */
    async getValueWithSchema<T extends Schema>(schema: T): Promise<Schema.Types<T>> {
        if (schema.meta.options) return this.pickValueWithSchema(schema);
        switch (schema.meta.type) {
            case 'number':
                return (await this.number(schema.meta.description)) as Schema.Types<T>;
            case 'string':
                return (await this.text(schema.meta.description)) as Schema.Types<T>;
            case 'boolean':
                return (await this.confirm(schema.meta.description)) as Schema.Types<T>;
            case 'object':
                if (schema.meta.description) await this.event.$reply(schema.meta.description);
                return (await this.getValueWithSchemas(schema.options.object!)) as Schema.Types<T>;
            case 'date':
                return await this.prompt({
                    tips: schema.meta.description,
                    defaultValue: schema.meta.default || new Date(),
                    format: (input: string) => new Date(input) as Schema.Types<T>,
                });
            case 'regexp':
                return await this.prompt({
                    tips: schema.meta.description,
                    defaultValue: schema.meta.default || '',
                    format: (input: string) => new RegExp(input) as Schema.Types<T>,
                });
            case 'const':
                return await this.const(schema.meta.default!);
            case 'list':
                const inner = schema.options.inner!;
                if (!['string', 'boolean', 'number'].includes(inner.meta.type))
                    throw new Error(`unsupported inner type :${inner.meta.type}`);
                return (await this.list(schema.meta.description, {
                    type: inner.meta.type === 'string' ? 'text' : (inner.meta.type as Prompt.SingleType),
                    defaultValue: schema.meta.default,
                })) as Schema.Types<T>;
            case 'dict':
            default:
                throw new Error(`Unsupported schema input type: ${schema.meta.type}`);
        }
    }
}
/**
 * Prompt命名空间：类型辅助定义
 */
export namespace Prompt {
    interface SingleMap {
        text: string;
        number: number;
        boolean: boolean;
    }
    export interface ListConfig<T extends SingleType> {
        type: T;
        defaultValue?: SingleMap[T][];
        separator?: string;
        timeout?: number;
    }
    export interface PickConfig<T extends SingleType = SingleType, M extends boolean = false> {
        type: T;
        defaultValue?: PickResult<T, M>;
        separator?: string;
        timeout?: number;
        options: PickOption<T>[];
        multiple?: M;
    }
    export type PickOption<T extends SingleType = 'text'> = {
        label: string;
        value: SingleMap[T];
    };
    export type PickResult<T extends SingleType, M extends boolean> = M extends true ? Result<T>[] : Result<T>;
    export type SingleType = keyof SingleMap;
    export type Result<T extends SingleType> = SingleMap[T];
    export type Config<R = any> = {
        tips: string;
        defaultValue?: R;
        timeout?: number;
        timeoutText?: string;
        format: (input: string) => R;
    };
}
