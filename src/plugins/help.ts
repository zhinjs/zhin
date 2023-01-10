import {App} from "@/app";
export const name='systemHelper'
export function install(bot:App){
    bot.on('command-add',(command)=>{
        command.option('help','-h 显示帮助信息',{hidden:true})
            .action(({options})=>{
                if(options.help) return command.help().concat('回复“帮助 指令名”以查看对应指令帮助。').join('\n')
            })
    })
    bot.command('help [command:string]')
        .desc('zhin帮助指令')
        .shortcut('帮助',{fuzzy:true})
        .option('showHidden','-H 显示隐藏选项')
        .option('showAuth','-A 显示权限信息')
        .action(({options,session,argv},target)=>{
            if (!target) {
                const commands = bot.commandList.filter(cmd => cmd.parent === null)
                const output = commands.map(command=>command.help({...options,simple:true,dep:0})).flat()
                output.push('回复“帮助 指令名”以查看对应指令帮助。')
                return output.filter(Boolean).join('\n')
            }

            const command = bot.findCommand({name: target,session, segments:session.segments,argv})
            if (!command?.match(session)) {
                return
            }

            return command.help({...options,dep:1}).concat('回复“帮助 指令名”以查看对应指令帮助。').join('\n')
        })
}
