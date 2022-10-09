import {Bot} from "@/bot";

export function install(bot:Bot,config:DaemonConfig={}){
    const {exitCommand=true, autoRestart = true} = config||{}

    function handleSignal(signal: NodeJS.Signals) {
        bot.logger.info(`terminated by ${signal}`)
        process.exit()
    }
    exitCommand && bot
        .command(exitCommand === true ? 'exit' : exitCommand)
        .desc('关闭bot')
        .auth('master','admins')
        .option('restart', '-r  重新启动')
        .shortcut('关机')
        .shortcut('重启', {options: {restart: true}})
        .action(async ({options, event}) => {
            const channelId = [event.message_type, event['group_id'] || event['discuss_id'] || event.user_id].join(':');
            if (!options.restart) {
                await event.reply('正在关机...').catch(()=>{})
                process.exit()
            }
            process.send({type: 'queue', body: {channelId, message: '已成功重启.'}})
            await event.reply('正在重启...').catch(()=>{})
            process.exit(51)
        })
    bot.on('ready', () => {
        process.send({type: 'start', body: {autoRestart}})
        process.on('SIGINT', handleSignal)
        process.on('SIGTERM', handleSignal)
    })

    interface Message {
        type: 'send'
        body: any
    }
    process.on('message', (data: Message) => {
        if (data.type === 'send') {
            const {channelId, message} = data.body
            if (bot && bot.isOnline()) {
                bot.sendMsg(channelId, message)
            } else {
                const dispose = bot.on('system.online', () => {
                    bot.sendMsg(channelId, message)
                    dispose()
                })
            }
        }
    })

}
export interface DaemonConfig {
    autoRestart?: boolean
    exitCommand?: string|boolean
}