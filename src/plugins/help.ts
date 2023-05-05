import {useContext} from "@";

export const name = 'systemHelper'
const ctx = useContext()
ctx.command('help [command:string]')
    .desc('查看某个指令的帮助文档')
    .shortcut('帮助', {fuzzy: true})
    .option('showHidden', '-H 显示隐藏选项')
    .option('showAuth', '-A 显示权限信息')
    .action(({options, session, argv}, target) => {
        if (!target) {
            const commands = ctx.zhin.getSupportCommands(session).filter(cmd => {
                if (options.showHidden) return cmd.parent === null && cmd.match(session)
                return !cmd.config.hidden && cmd.parent === null && cmd.match(session)
            })
            const output = commands.map(command => command.help({...options, simple: true, dep: 0})).flat()
            output.push('回复“help [指令名]”查看指令帮助')
            return output.filter(Boolean).join('\n')
        }

        return ctx.zhin
            .findCommand({name: target, session, elements: session.elements ||= [], argv})
            ?.help({...options, dep: 1})
            .concat('回复“help [指令名]”查看指令帮助').join('\n')
    })
const dispose = ctx.zhin.on('command-add', (command) => {
    command.option('help', '-h 查看帮助', {hidden: true})
        .action(({options}) => {
            if (options.help) return command.help().concat('回复“help [指令名]”查看指令帮助').join('\n')
        })
})
ctx.on('dispose', () => {
    dispose()
})

