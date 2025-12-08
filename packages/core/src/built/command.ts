import { MessageCommand } from "../command.js";
import { RegisteredAdapter,AdapterMessage } from "../types.js";
import { Message } from "../message.js";
import { Plugin } from "../plugin.js";
import { remove } from "../utils";
export class CommandService extends Array<MessageCommand<RegisteredAdapter>>{
    constructor() {
        super();
    }
    addCommand(command: MessageCommand<RegisteredAdapter>) {
        this.push(command);
    }
    removeCommand(command: MessageCommand<RegisteredAdapter>) {
        remove(this, command);
    }
    async handle(message: Message<AdapterMessage<RegisteredAdapter>>, plugin: Plugin) {
        for(const command of this){
            const result = await command.handle(message, plugin);
            if(result) return result;
        }
    }
}