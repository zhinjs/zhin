import { Adapter, Plugin, Bot, SendContent, SendOptions, MessageBase, Message, segment } from "@zhin.js/core";
export class ProcessBot implements Bot<{},{content:string,ts:number}>{
    $id=`${process.pid}`;
    get logger() {
        return this.adapter.logger;
    }
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
        process.stdin.on('data', this.$listenInput);
    }
    async disconnect() {
        process.stdin.removeListener('data', this.$listenInput);
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
                return await this.$sendMessage({
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
        this.logger.info(`${this.$id} send: ${segment.raw(options.content)}`);
        return `${Date.now()}`;
    }
    $connect(): Promise<void> {
        return this.connect();
    }
    async $disconnect() {
    }
}
export class ProcessAdapter extends Adapter<ProcessBot>{
    constructor(plugin: Plugin) {
        super(plugin, 'process', [{}]);
    }
    createBot(): ProcessBot {
        return new ProcessBot(this);
    }
}
declare module '@zhin.js/core'{
    interface RegisteredAdapters{
        process:ProcessAdapter
    }
}