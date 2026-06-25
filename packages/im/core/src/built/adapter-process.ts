import { formatCompact } from "@zhin.js/logger";
import { Adapter } from "../adapter.js";
import { Plugin } from "../plugin.js";
import { Endpoint } from "../endpoint.js";
import { Message, type MessageBase } from "../message.js";
import type { SendContent, SendOptions } from "../types.js";
import { segment } from "../utils.js";
import { assertOutbound } from "../endpoint-capabilities.js";
import { getOutboundReplyStore } from "./dispatcher.js";
import { bindStdin, runtimePid, runtimeUser } from "./runtime-io.js";
import { interpretOriginQrcodeForProcess } from "./rich-segments/qrcode-segment.js";
import type { OutboundRichSegmentPolicy } from "./rich-segments/types.js";

export class ProcessEndpoint implements Endpoint<{ owner?: string },{content:string,ts:number}>{
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
            $endpoint: runtimePid(),
            $sender: {
                id: runtimeUser(),
                name: runtimeUser(),
                role: 'master',
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
                    endpoint: base.$endpoint,
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
        const content = await interpretOriginQrcodeForProcess(options.content ?? '');
        if (content != null) {
            const preview = segment.raw(content);
            if (preview) {
                process.stdout.write(`${preview}\n`);
            }
        }
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
export class ProcessAdapter extends Adapter<ProcessEndpoint>{
    static override readonly capabilities = ['inbound', 'outbound'] as const;
    static override outboundRichSegmentPolicy: OutboundRichSegmentPolicy = {
        qrcode: 'origin',
        html: 'text',
        markdown: 'text',
    };

    constructor(plugin: Plugin) {
        super(plugin, 'process', [{ owner: runtimePid() }]);
    }

    /**
     * process 出站由 $sendMessage 写入 stdout；父类 INFO preview 会与终端输出重复，故仅 debug 元数据。
     */
    override async sendMessage(options: SendOptions): Promise<string> {
        options = await this.renderSendMessage(options);
        const endpoint = this.endpoints.get(options.endpoint);
        if (!endpoint) throw new Error(`Endpoint ${options.endpoint} not found`);
        assertOutbound(endpoint);
        this.logger.debug(formatCompact({
            send: `${options.type}(${options.id})`,
            endpoint: options.endpoint,
        }));
        const messageId = await endpoint.$sendMessage(options);
        const replyStore = getOutboundReplyStore();
        this.plugin.root.dispatch('message.send', {
            adapter: this.name,
            options,
            messageId,
            replySource: replyStore?.source,
            replyMessage: replyStore?.message,
        });
        return messageId;
    }

    createEndpoint(config: Adapter.EndpointConfig<ProcessEndpoint>): ProcessEndpoint {
        return new ProcessEndpoint(this, config);
    }
}
declare module '../adapter.js'{
    interface Adapters{
        process:ProcessAdapter
    }
}