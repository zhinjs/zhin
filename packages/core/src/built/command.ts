import { MessageCommand, RegisteredAdapter, AdapterMessage, Message, Plugin, remove } from "@zhin.js/core";
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