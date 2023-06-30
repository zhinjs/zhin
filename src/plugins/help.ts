import {NSession, useContext, Zhin} from "@";

export const name = 'systemHelper'
const ctx = useContext()
ctx.command('help [command:string]')
    .desc('查看某个指令的帮助文档')
    .alias('帮助')
    .option('-> <simple:boolean> 简单模式',false)
    .option('-H [showHidden:boolean] 显示隐藏选项')
    .action<NSession< keyof Zhin.Adapters>>(({options, session}, target) => {
        const supportCommands = ctx.zhin.getSupportCommands(session)
        if (!target) {
            const commands = supportCommands.filter(cmd => {
                if (options.showHidden) return cmd.parent === null
                return !cmd.config.hidden && cmd.parent === null
            })
            const output = commands.map(command => command.help({...options, simple: true, dep: 0},supportCommands)).flat()
            output.push('回复“help [指令名]”查看指令帮助')
            return output.filter(Boolean).join('\n')
        }

        return ctx.zhin.findCommand(target)?.help({...options, dep: 1},supportCommands)
            .concat('回复“help [指令名]”查看指令帮助').join('\n')
    })
const dispose = ctx.zhin.on('command-add', (command) => {
    command.option('-h [help:boolean] 查看帮助')
        .action(({options}) => {
            if (options.help) return command.help().concat('回复“help [指令名]”查看指令帮助').join('\n')
        })
})
ctx.on('dispose', () => {
    dispose()
})

