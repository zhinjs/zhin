import {App} from "@/app";
import {Adapters, Bot} from "@";
export const name='systemDaemon'
export function install(app:App, config:DaemonConfig={}){
    const {exitCommand=true, autoRestart = true} = config||{}

    function handleSignal(signal: NodeJS.Signals) {
        app.logger.info(`terminated by ${signal}`)
        process.exit()
    }
    exitCommand && app
        .command(exitCommand === true ? 'exit' : exitCommand)
        .desc('关闭bot')
        .auth('master','admins')
        .option('restart', '-r  重新启动')
        .shortcut('关机')
        .shortcut('重启', {options: {restart: true}})
        .action(async ({options,session}) => {
            const channelId = Bot.getFullTargetId(session);
            if (!options.restart) {
                await session.reply('正在关机...').catch(()=>{})
                process.exit()
            }
            process.send({type: 'queue', body: {channelId, message: '已成功重启.'}})
            await session.reply('正在重启...').catch(()=>{})
            process.exit(51)
        })
    app.on('ready', () => {
        process.send({type: 'start', body: {autoRestart}})
        process.on('SIGINT', handleSignal)
        process.on('SIGTERM', handleSignal)
    })

    interface Message {
        type: 'send'
        body: any,
        times?:number
    }
    process.on('message', (data: Message) => {
        if (data.type === 'send') {
            let {channelId, message} = data.body
            const [platform,self_id,target_type,target_id]=channelId.split(':')
            const times=data.times
            const bot=app.pickBot(platform as keyof Adapters,self_id)
            if (bot && bot.isOnline()) {
                if(times) message+=`耗时：${(new Date().getTime()-times)/1000}s`
                bot.sendMsg(target_id,target_type, message)
            } else {
                const dispose = app.on('oicq.system.online', () => {
                    if(times) message+=`耗时：${(new Date().getTime()-times)/1000}s`
                    bot.sendMsg(target_id,target_type, message)
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