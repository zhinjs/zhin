import {watch,FSWatcher} from 'chokidar'
import { App, Plugin, wrapExport } from '@';
import * as path from "path";
import * as fs from "fs";
import * as process from 'process';

const HMR = new Plugin('HMR')
let watcher:FSWatcher
HMR.unmounted(()=>{
    watcher?.close()
})
HMR.mounted((app)=>{
    const configFiles=[
      `${process.env.cofnig}.js`,
      `${process.env.config}.ts`,
        `${process.env.cofnig}.cjs`,
        `${process.env.config}.mts`,
    ].filter(filePath=>fs.existsSync(filePath))
    const watchDirs = [ // 只监听本地插件和内置插件的变更，模块的管不了
        ...(app.config.pluginDirs||[]).map(dir=>{
            return path.resolve(process.cwd(),dir)
        }),// 本地目录插件
        __dirname, // 内置插件
        ...configFiles,
        path.resolve(process.cwd(), `.${process.env.mode}.env`), // 环境变量
    ].filter(Boolean)
    watcher = watch(watchDirs.filter(p => {
        return fs.existsSync(p)
    }))
    const reloadProject = (filename:string) => {
        app.logger.info(`\`${filename}\` changed restarting ...`)
        return process.exit(51)
    }
    const reloadPlugin=(filePath:string,plugin:Plugin)=>{
        app.logger.debug(`插件：${plugin.display_name} 产生变更，即将更新`)
        const oldCache = require.cache[filePath]
        if(plugin===HMR) watcher.close()
        app.unmount(plugin)
        delete require.cache[filePath]
        try {
            app.mount(filePath)
        } catch (e) {
            require.cache[filePath] = oldCache
            app.mount(filePath)
        }
    }
    const reloadPlugins = (filePath: string) => {
        const plugins = app.pluginList.filter(p => p.filePath === filePath)
        if(!plugins.length) return
        for(const plugin of plugins) {
            reloadPlugin(filePath,plugin)
        }
    }
    const changeConfig=(config:Partial<App.Config>)=>{
        const beforePlugins=Array.isArray(app.config.plugins)?app.config.plugins:Object.keys(app.config.plugins)
        const afterPlugins=Array.isArray(config.plugins)?config.plugins:Object.keys(config.plugins||{})
        const addPlugins=afterPlugins.filter((p)=>!beforePlugins.includes(p))
        const removePlugins=beforePlugins.filter((p)=>!afterPlugins.includes(p))
        app.initPlugins(addPlugins)
        for(const plugin of removePlugins){
            const name=typeof plugin === 'string' ? plugin:plugin.name!
            const p=app.plugins.get(name)
            if(p) {
                app.unmount(p)
                delete require.cache[p.filePath]
            }
        }
        app.config.plugins=config.plugins||[]
    }

    const changeListener = (filePath: string) => {
        if (filePath.startsWith('.env')) {
            return reloadProject(filePath.replace(path.dirname(filePath)+'/',''))
        }
        const pluginFiles = app.pluginList.map(p => p.filePath)
        if (watchDirs.some(dir => filePath.startsWith(dir)) && pluginFiles.includes(filePath)) {
            return reloadPlugins(filePath)
        }
        if(filePath.startsWith(process.env.config as string)){
            delete require.cache[filePath]
            const config=wrapExport(filePath)
            return changeConfig(typeof config==='function'?config(process.env):config)
        }
    }
    watcher.on('change', changeListener)
})
export default HMR
