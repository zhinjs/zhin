import { Adapter, Plugin, Bot, SendContent, SendOptions, MessageBase, Message, segment } from "@zhin.js/core";
import { bindStdin, runtimePid, runtimeUser } from "./runtime-io.js";

export class ProcessBot implements Bot<{ owner?: string },{content:string,ts:number}>{
    $id = runtimePid();
    get logger() {
        return this.adapter.logger;
    }
    $connected=false;
    #unbindStdin: (() => void) | null = null;
    constructor(public adapter: ProcessAdapter, public $config: { owner?: string }={ owner: runtimePid() }) {
        this.$listenInput=this.$listenInput.bind(this);
    }
    $listenInput(chunk: string) {
        const content = chunk.trim();
        if (content) {
            this.adapter.emit('message.receive', this.$formatMessage({content,ts:Date.now()}));
        }
    }
    async connect() {
    }
    async disconnect() {
    }
    $formatMessage(event: {content:string,ts:number}): Message<{content:string,ts:number}> {
        const base:MessageBase={
            $id: `${event.ts}`,
            $adapter: 'process',
            $bot: runtimePid(),
            $sender: {
                id: runtimeUser(),
                name: runtimeUser(),
            },
            $channel: {
                id: runtimeUser(),
                type: 'private',
            },
            $content: [{type:'text',data:{text:event.content}}],
            $raw: event.content,
            $timestamp: event.ts,
            $recall: async () => {
                await this.$recallMessage(base.$id)
            },
            $reply: async (content: SendContent) => {
                return await this.adapter.sendMessage({
                    context: 'process',
                    bot: base.$bot,
                    content,
                    id: base.$sender.id,
                    type: base.$channel.type,
                });
            },
        }
        return Message.from(event, base);
    }
    async $recallMessage(id: string) {
    }
    async $sendMessage(options: SendOptions) {
        return `${Date.now()}`;
    }
    async $connect(): Promise<void> {
        this.#unbindStdin = bindStdin((chunk) => this.$listenInput(chunk));
        this.$connected = true;
    }
    async $disconnect() {
        this.#unbindStdin?.();
        this.#unbindStdin = null;
    }
}
export class ProcessAdapter extends Adapter<ProcessBot>{
    constructor(plugin: Plugin) {
        super(plugin, 'process', [{ owner: runtimePid() }]);
    }
    
    createBot(config: Adapter.BotConfig<ProcessBot>): ProcessBot {
        return new ProcessBot(this, config);
    }
}
declare module '../adapter.js'{
    interface Adapters{
        process:ProcessAdapter
    }
}