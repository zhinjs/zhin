import {FSWatcher, watch} from 'chokidar'
import {useOptions, Zhin, Schema, useContext} from "@";
import * as fs from 'fs';
import * as Yaml from 'js-yaml'
import * as path from "path";
import {Plugin} from "@/plugin";

const ctx = useContext()
const Config = Schema.string().default(process.cwd()).required().description('监听路径')
const root = Config(useOptions('plugins.watcher'))

function reloadDependency(plugin: Plugin, changeFile: string, withErr?: boolean) {
    const context = plugin.context
    if (!withErr) {
        plugin.unmount()
        delete require.cache[changeFile]
        if (changeFile !== plugin.options.fullPath) {
            delete require.cache[plugin.options.fullPath]
            delete require.cache[plugin.options.fullPath + '/index.js']
            delete require.cache[plugin.options.fullPath + '/index.ts']
            delete require.cache[plugin.options.fullPath + '/index.cjs']
            delete require.cache[plugin.options.fullPath + '/index.mjs']
        }
    }
    const newPlugin = ctx.app.load(plugin.options.fullPath, 'plugin', plugin.options.setup)
    try {
        context.parent.plugin(newPlugin)
        ctx.app.logger.info(`已重载插件:${newPlugin.name}`)
    } catch (e) {
        ctx.app.logger.warn(e)
        context.parent.plugins.delete(newPlugin.fullName)
        ctx.app.logger.mark('请先处理错误')
        plugin.context = context
        let listener
        watcher.on('change', listener = (filename) => {
            if (filename !== changeFile) return
            watcher.off('change', listener)
            reloadDependency(plugin, changeFile, true)
        })
    }
}

const watchPath = path.resolve(process.cwd(), root || '.')
const watcher: FSWatcher = watch(watchPath, {
    ignored: ['**/node_modules/**', '**/.git/**', '**/.idea/**']
})
watcher.on('unlink', (filename) => {
    const plugins = ctx.app.pluginList.filter((p) => p.dependencies.includes(filename))
    for (const plugin of plugins) {
        plugin.unmount()
    }
})
watcher.on('change', (filename) => {
    if (path.resolve(process.env.configPath ||= 'zhin.yaml') === filename) {
        const newOptions: Zhin.Options = Yaml.load(fs.readFileSync(process.env.configPath, "utf8")) as any
        ctx.app.changeOptions(newOptions)
    } else {
        const plugins = ctx.app.pluginList.filter((p) => p.dependencies.includes(filename))
        for (const plugin of plugins) {
            reloadDependency(plugin, filename)
        }
    }
})
ctx.on('dispose', () => {
    watcher.close()
    return true
})