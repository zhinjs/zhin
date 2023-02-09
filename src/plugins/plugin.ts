import {Context} from "@/context";

export const name = 'pluginManage'

export function install(ctx: Context) {
    const command = ctx.command('plugin')
        .desc('插件管理')
        .hidden()
    command.subcommand('plugin.list',"group")
        .desc('显示插件列表')
        .action(({session}) => {
            return ctx.app.getCachedPluginList().map((plugin, idx) => {
                return `${idx + 1}. 插件名：${plugin.fullName}${ctx.app.hasInstall(plugin.fullName) ? ' (已安装)' : ''} ${plugin.type}`
            }).join('\n')
        })
    command.subcommand('plugin.detail <name:string>')
        .desc('查看指定插件详情')
        .action(({options}, name) => {
            const plugin = ctx.app.pluginList.find(p => p.options.fullName === name)
            if (!plugin) return '未找到插件：' + name
            return JSON.stringify(plugin.info, null, 2)
                .replace(/"/g, '')
                .replace(/\\/g, '')
        })
    command.subcommand('plugin.enable <name:string>')
        .desc('启用指定插件')
        .action(({options,session}, name) => {
            const plugin = ctx.app.pluginList.find(p => p.options.fullName === name)
            if (!plugin) return '未找到插件：' + name
            session.bot.enable(plugin)
            return `启用插件(${name})成功`
        })
    command.subcommand('plugin.disable <name:string>')
        .desc('禁用指定插件')
        .action(({options,session}, name) => {
            const plugin = ctx.app.pluginList.find(p => p.options.fullName === name)
            if (!plugin) return '未找到插件：' + name
            session.bot.disable(plugin)
            return `禁用插件(${name})成功`
        })
}