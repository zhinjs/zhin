import { Adapter, Plugin, Bot, SendContent, SendOptions, MessageBase, Message, segment } from "@zhin.js/core";
export class ProcessBot implements Bot<{},{content:string,ts:number}>{
    $id=`${process.pid}`;
    get logger() {
        return this.adapter.logger;
    }
    $connected=false;
    constructor(public adapter: ProcessAdapter, public $config={}) {
        this.$listenInput=this.$listenInput.bind(this);
    }
    $listenInput:(data:Buffer<ArrayBufferLike>)=>void=function (this:ProcessBot,data){
        const content = data.toString().trim();
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
            $bot: `${process.pid}`,
            $sender: {
                id: `${process.pid}`,
                name: process.title,
            },
            $channel: {
                id: `${process.pid}`,
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
                    id: base.$id,
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
        process.stdin.on('data', this.$listenInput);
        this.$connected = true;
    }
    async $disconnect() {
        process.stdin.removeListener('data', this.$listenInput);
    }
}
export class ProcessAdapter extends Adapter<ProcessBot>{
    constructor(plugin: Plugin) {
        super(plugin, 'process', [{}]);
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