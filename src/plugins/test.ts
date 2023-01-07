import {App} from "@";

export const name = 'test'

export function install(app: App) {
    app.command('send <message:text>')
        .action((_, message) => {
            return message
        })
}