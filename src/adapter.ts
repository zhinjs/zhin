import { Bot, BotConstruct, BotList, BotOptions } from "./bot";
import { Zhin } from "./zhin";
import { NSession, Session } from "./session";
import { Logger } from "log4js";
import { EventEmitter } from "events";
import { Dispose } from "./dispose";
import { Context } from "@/context";

interface AdapterConstruct<
    K extends keyof Zhin.Adapters = keyof Zhin.Adapters,
    BO extends BotOptions = BotOptions,
    AO = {},
> {
    new (zhin: Zhin, protocol: K, options: AdapterOptions<BO, AO>): Zhin.Adapters[K];
}

export type AdapterOptions<BO = {}, AO = {}> = {
    bots?: BotOptions<BO>[];
} & AO;
export type AdapterOptionsType<T extends Zhin.Adapters[keyof Zhin.Adapters]> = T extends Adapter<
    infer K,
    infer BO,
    infer AO
>
    ? AdapterOptions<BO, AO>
    : unknown;

export abstract class Adapter<
    K extends keyof Zhin.Adapters = keyof Zhin.Adapters,
    BO = {},
    AO = {},
> extends EventEmitter {
    public bots: BotList<K>;
    logger: Logger;
    private _status: Record<string, Adapter.BotStatus> = {};

    protected constructor(
        public zhin: Zhin,
        public protocol: K,
        public options: AdapterOptions<BO, AO>,
    ) {
        super();
        this.bots = new BotList();
        this.logger = zhin.getLogger(protocol);
        this.zhin.on("start", () => this.start());
        this.on("message.receive", (self_id: string | number, session: NSession<K>) => {
            this.zhin.logger.info(
                `【${this.protocol}:${self_id}】 ↓ ( ${session.message_id} )\t${session.content}`,
            );
            this.botStatus(self_id).recv_msg_cnt++;
        });
        this.on("bot.online", bot_id => {
            this.botStatus(bot_id).online = true;
            this.zhin.logger.info(`【${this.protocol}:${bot_id}】已上线`);
            this.zhin.emit(`bot.online`, this.protocol, bot_id);
        });
        this.on("bot.offline", bot_id => {
            this.botStatus(bot_id).online = false;
            this.zhin.logger.info(`【${this.protocol}:${bot_id}】已掉线`);
            this.zhin.emit(`bot.offline`, this.protocol, bot_id);
        });
        this.on("bot.error", (bot_id, error) => {
            this.zhin.logger.error(`【${this.protocol}:${bot_id}】`, error);
            this.zhin.emit(`bot.error`, this.protocol, bot_id, error);
        });
        this.on("message.send", (bot_id: string | number, message: Bot.MessageRet) => {
            let cache = this._cache.get(String(bot_id));
            if (!cache) this._cache.set(String(bot_id), (cache = new Map<number, Set<string>>()));
            let time = Number.parseInt(Date.now() / 1000 + "");
            let set = cache.get(time);
            if (!set) cache.set(time, (set = new Set()));
            set.add(message.message_id);
            this.botStatus(bot_id).sent_msg_cnt++;
            this.zhin.logger.info(
                `【${this.protocol}:${bot_id}】 ↑ ( ${message.message_id} )\t${message.content}`,
            );
            this.zhin.emit("message.send", message);
        });
    }

    protected readonly _cache = new Map<string, Map<number, Set<string>>>();

    protected _calcMsgCntPerMin(bot_id: string) {
        let cnt = 0;
        let cache = this._cache.get(bot_id);
        if (!cache) this._cache.set(bot_id, (cache = new Map<number, Set<string>>()));
        for (let [time, set] of cache) {
            if (Date.now() / 1000 - time >= 60) cache.delete(time);
            else cnt += set.size;
        }
        return cnt;
    }

    get status() {
        Object.keys(this._status).forEach(bot_id => {
            this._status[bot_id].msg_cnt_per_min = this._calcMsgCntPerMin(bot_id);
        });
        return this._status;
    }

    botStatus(self_id: string | number) {
        return (this.status[self_id] ||= {
            lost_times: 0,
            msg_cnt_per_min: 0,
            online: false,
            recv_msg_cnt: 0,
            sent_msg_cnt: 0,
            start_time: 0,
        });
    }

    getLogger(sub_type: string) {
        return this.zhin.getLogger(this.protocol, sub_type);
    }

    on(event, listener) {
        super.on(event, listener);
        return Dispose.from(this, () => {
            super.off(event, listener);
        });
    }

    changeOptions(bot_id: string | number, options: BotOptions<BO>) {
        const idx = this.options.bots.findIndex(opt => opt.self_id === bot_id);
        if (idx === -1) return;
        this.options.bots[idx] = options;
    }

    dispatch<E extends keyof Zhin.BotEventMaps[K]>(eventName: E, session: NSession<K, E>) {
        this.emit(eventName as any, session);
        if (session instanceof Session) {
            this.zhin.dispatch(this.protocol, eventName, session);
        }
    }

    protected async start(...args: any[]) {
        for (const botOptions of this.options.bots) {
            this.startBot(botOptions);
        }
    }

    async stop(...args: any[]) {}

    protected startBot(options: BotOptions<BO>) {
        const Construct = Bot.botConstructors[this.protocol];
        if (!Construct)
            throw new Error(`can not find bot constructor from protocol:${this.protocol}`);
        const bot = new Construct(this.zhin, this as any, options);
        this.status[bot.self_id] = {
            lost_times: 0,
            msg_cnt_per_min: 0,
            recv_msg_cnt: 0,
            sent_msg_cnt: 0,
            start_time: 0,
            online: false,
        };
        bot.start();
        this.botStatus(bot.self_id).start_time = Date.now();
        this.bots.push(bot);
    }
}

export type AdapterConstructs = {
    [P in keyof Zhin.Adapters]?: AdapterConstruct;
};
export namespace Adapter {
    export const adapterConstructs: AdapterConstructs = {};

    export function define<K extends keyof Zhin.Adapters, BO = {}, AO = {}>(
        key: K,
        protocolConstruct: AdapterConstruct<K, BO, AO>,
        botConstruct: BotConstruct<K, BO, AO>,
    ) {
        adapterConstructs[key] = protocolConstruct;
        Bot.define(key, botConstruct);
    }

    export interface Install<T = any> {
        install(ctx: Context, config?: T);
    }

    export interface BotStatus {
        start_time: number;
        lost_times: number;
        recv_msg_cnt: number;
        sent_msg_cnt: number;
        msg_cnt_per_min: number;
        online: boolean;
    }

    export function get<K extends keyof Zhin.Adapters>(protocol: K) {
        return {
            Adapter: adapterConstructs[protocol],
            Bot: Bot.botConstructors[protocol],
        };
    }
}
