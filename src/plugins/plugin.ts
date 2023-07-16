import {Context} from "@/context";
import {Plugin} from "@/plugin";
import {NSession} from '@'
import {exec} from "child_process";
import {promisify} from 'util'
import {Session, useContext, Zhin} from "@";

const promiseExec = promisify(exec)
const changeDependency = async (name?: string, unInstall?: boolean) => {
    const cmd = `npm ${unInstall ? 'un' : ''}install ${name ?? ''} --force`
    const {stderr} = await promiseExec(cmd, {cwd: process.cwd()})
    if (stderr) {
        if (/npm ERR/i.test(stderr)) {
            return [false, stderr]
        }
    }
    return [true, '']
}
const ctx = useContext()

function getPluginStatus(ctx: Context, session: Session, fullName: string) {
    if (session.bot.options.disable_plugins.includes(fullName)) return '□'
    const plugin = ctx.pluginList.find(p => p.options.fullName === fullName)
    if (!plugin) return '■'
    const flag: `${keyof Zhin.Adapters}:${string | number}` = `${session.protocol}:${session.bot.self_id}`
    if (plugin.disableBots.includes(flag)) return '□'
}

ctx.command('plugin [action:string] [name:string]')
    .desc('插件管理')
    .hidden()
    .action<NSession<keyof Zhin.Adapters>>(({session}, action, name) => {
        return session.execute(`plugin.${action} ${name}`)
    })
ctx.command('plugin/plugin.list')
    .desc('模块列表')
    .option('-c [cloud:boolean] npm模块')
    .action<NSession<keyof Zhin.Adapters>>(async ({session, options}) => {
        if (!options.cloud) {
            const plugins = ctx.zhin.getInstalledModules('plugin')
            return plugins.map((o, idx) => {
                const installStatus = ctx.zhin.hasMounted(o.fullName)
                let enableStatus = installStatus ? getPluginStatus(ctx, session, o.fullName) : '□'
                return `${enableStatus} ${o.name}`
            }).join('\n')+`\n\n■:已启用 □:未启用`
        } else {
            const packages = await ctx.zhin.getMarketPackages()
            const plugins = ctx.zhin.getInstalledModules('plugin')
            const adapters = ctx.zhin.getInstalledModules('adapter')
            const services = ctx.zhin.getInstalledModules('service')
            const localPlugins = [...plugins, ...adapters, ...services]
            return packages.map((o, idx) => {
                const installStatus = localPlugins.some(p => p['fullName'] === o.name)
                const installVersion = localPlugins.find(p => p['fullName'] === o.name)?.['version']
                const isLatest = installVersion === o.version
                return `${installStatus ? '●' : '○'} ${o.name}@${o.version}${isLatest ? ' (latest)' : installStatus?`(${installVersion})`:''}`
            }).join('\n')+`\n\n●:已安装 ○:未安装`
        }
    })


ctx.master()
    .command('plugin/plugin.install <fullName:string>')
    .desc('安装模块')
    .option('-v [version:string] 指定版本，默认最新版')
    .action<NSession<keyof Zhin.Adapters>>(async ({session, options}, name) => {
        const packages = await ctx.zhin.getMarketPackages()
        const info = packages.find(p => p.name === name)
        if (!info) return '该模块不存在'
        await session.reply('已开始安装...')
        try {
            const [success, err] = await changeDependency(`${name}@${options.version || info.version}`)
            return success ? '安装成功' : `安装失败:\n${err}`
        } catch (e) {
            ctx.zhin.logger.warn(e.message)
            return `安装失败:\n${e.message}`
        }
    })
ctx.master()
    .command('plugin/plugin.uninstall <fullName:string>')
    .desc('卸载模块')
    .action<NSession<keyof Zhin.Adapters>>(async ({session}, name) => {
        const packages = ctx.zhin.getInstalledModules('plugin')
        const options = packages.find(p => p.name === name)
        if (!options) return '没有安装该模块'
        if ([Plugin.Source.built, Plugin.Source.local].includes(options.type)) return '本地/内置不允许卸载'
        await session.reply('已开始卸载...')
        try {
            const [success, err] = await changeDependency(`${options.fullName}`, true)
            return success ? '卸载成功' : `卸载失败:\n${err}`
        } catch (e) {
            ctx.zhin.logger.error(e.message, e.stack)
            return `卸载失败:\n${e.message}`
        }
    })
ctx.role('master', "admins")
    .command('plugin/plugin.mount <name:string>')
    .desc('载入插件')
    .action<NSession<keyof Zhin.Adapters>>(async ({session}, name) => {
        const plugins = await ctx.zhin.getInstalledModules('plugin')
        const options = plugins.find(p =>p.fullName===name|| p.name === name)
        if (!options) return '没有安装该插件'
        try {
            ctx.zhin.plugin(name)
        } catch (e) {
            return '加载失败：' + e.message
        }
        return '载入成功'
    })
ctx.role('master', "admins")
    .command('plugin/plugin.unmount <name:string>')
    .desc('移除插件')
    .action(({session}, name) => {
        const plugin = ctx.zhin.pluginList.find(p =>p.options.fullName===name || p.options.name === name)
        if (!plugin) return '没有载入该插件'
        try {
            plugin.unmount()
        } catch (e) {
            return '加载失败：' + e.message
        }
        return '移除成功'
    })
ctx.command('plugin/plugin.detail <name:string>')
    .desc('查看指定插件详情')
    .action(async ({options}, name) => {
        const plugin = ctx.zhin.pluginList.find(p => p.options.fullName === name || p.options.name === name)
        if (!plugin) {
            const packages = await ctx.zhin.getMarketPackages()
            const info = packages.find(p => p.name === name)
            if (info) return JSON.stringify(info, null, 2)
            return '未找到插件：' + name
        }
        return JSON.stringify(plugin.info, null, 2)
            .replace(/"/g, '')
            .replace(/\\/g, '')
    })
ctx.role('master', "admin", "owner", "admins")
    .command('plugin/plugin.on <name:string>')
    .desc('启用插件')
    .action<NSession<keyof Zhin.Adapters>>(({options, session}, name) => {
        const plugin = ctx.zhin.pluginList.find(p =>p.options.fullName===name || p.options.name === name)
        if (!plugin) return '未找到插件：' + name
        session.bot.enable(plugin)
        return `启用插件(${name})成功`
    })
ctx.role('master', "admin", "owner", "admins")
    .command('plugin/plugin.off <name:string>')
    .desc('停用插件')
    .action<NSession<keyof Zhin.Adapters>>(({options, session}, name) => {
        const plugin = ctx.zhin.pluginList.find(p =>p.options.fullName===name || p.options.name === name)
        if (!plugin) return '未找到插件：' + name
        session.bot.disable(plugin)
        return `禁用插件(${name})成功`
    })
