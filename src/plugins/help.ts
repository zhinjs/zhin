import {Bot, Command} from "@/index";
import {DiscussMessageEvent, GroupMessageEvent, PrivateMessageEvent} from "oicq/lib/events";


interface HelpOptions {
    showHidden?: boolean
    authority?: boolean
}
type MessageEvent=GroupMessageEvent|DiscussMessageEvent|PrivateMessageEvent
async function showHelp(command: Command, message: MessageEvent, config: HelpOptions) {
    const output = [`${command.name}${
        command.args.length ? ' ' + command.args.map(arg => {
            return arg.required ? `<${arg.variadic ? '...' : ''}${arg.name}:${arg.type}>` : `[${arg.variadic ? '...' : ''}${arg.name}:${arg.type}]`
        }).join(' ') : ''
    }     ${command.descriptions.join()}`]

    if (command.aliasNames.length) {
        output.push(`别名:${command.aliasNames.join(',')}`)
    }


    output.push(...getOptions(command, config))
    if (command.examples.length) {
        output.push(`举例:\n${command.examples.map(example => '    ' + example).join('\n')}` )
    }

    output.push(...formatCommands(message, command.children, config))

    return output.filter(Boolean).join('\n')
}
function* getCommands(session: MessageEvent, commands: Command[], showHidden = false): Generator<Command> {
    for (const command of commands) {
        if (command.match(session)) {
            yield command
        } else {
            yield* getCommands(session, command.children, showHidden)
        }
    }
}
function formatCommands(session: MessageEvent, children: Command[], options: HelpOptions) {
    const commands = Array
        .from(getCommands(session, children, options.showHidden))
        .sort((a, b) => a.name > b.name ? 1 : -1)
    if (!commands.length) return []

    let hasSubcommand = false
    const output = commands.map(({name, authority, descriptions}) => {
        let output = '  ' + name
        if (options.authority) output += '   ' + `(${authority})`
        output += ' ' + descriptions.join('\n')
        return output
    })
    if (hasSubcommand) output.unshift('子指令')
    return output
}


function getOptions(command: Command, config: HelpOptions) {
    const options:Command.OptionConfig[] = config.showHidden
        ? Object.values(command.options)
        : Object.values(command.options).filter((option:Command.OptionConfig) => option.hidden !== true)
    if (!options.length) return []

    const output = ['可选项:']

    options.filter((option, index) => options.findIndex((opt) => opt.shortName === option.shortName) === index).forEach((option) => {
        output.push(`${option.shortName},--${option.name}${option.declaration.type === 'boolean' ? '' : option.declaration.required ? ` <${option.name}:${option.declaration.type}>` : ` [${option.name}:${option.declaration.type}]`} ${option.description}`)
    })

    return output
}
export function install(bot:Bot,config:HelpOptions={}){
    bot.command('help [command:string]',"all")
        .desc('显示指令的帮助信息')
        .shortcut('帮助',{fuzzy:true})
        .action(({event,options,argv},target)=>{
            if (!target) {
                const commands = bot.commandList.filter(cmd => cmd.parent === null)
                const output = formatCommands(event, commands, options)
                output.push('回复“帮助 指令名”以查看对应指令帮助。')
                return output.filter(Boolean).join('\n')
            }

            const command = bot.findCommand({name: target, cqCode: event.cqCode,argv})
            if (!command?.match(event)) {
                return
            }

            return showHelp(command, event, options)
        })
    bot.on('command-add',(command)=>{
        command.option('help','-h 显示帮助信息',{hidden:true})
    })

}