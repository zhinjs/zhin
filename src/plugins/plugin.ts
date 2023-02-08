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
                return `${idx + 1}. 插件名：${plugin.options.fullName}${ctx.app.hasInstall(plugin.options.fullName) ? ' (已安装)' : ''} ${plugin.type}`
            }).join('\n')
        })
    command.subcommand('plugin.detail <name:string>')
        .desc('查看指定插件详情')
        .action(({options}, name) => {
            const {info} = ctx.app.pluginList.find(p => p.name === name) || {}
            if (!Object.keys(info).length) return '未找到插件：' + name
            return JSON.stringify(info, null, 2)
                .replace(/"/g, '')
                .replace(/\\/g, '')
        })
}