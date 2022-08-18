import {fork} from "child_process";
import {join,resolve} from 'path'
import * as fs from 'fs'
import * as Yaml from 'js-yaml'
import {Bot} from "@/bot";
export function createWorker(config:Bot.Options|string='zhin.yaml'){
    if(typeof config!=='string') fs.writeFileSync(join(process.cwd(),'zhin.yaml'),Yaml.dump(config))
    return fork(join(__dirname,'worker'),[],{
        env:{
            configPath:resolve(process.cwd(),typeof config==='string'?config:'zhin.yaml')
        },
        execArgv:[
            '-r', 'esbuild-register',
            '-r', 'tsconfig-paths/register'
        ]
    })
}
export * from './argv'
export * from './bot'
export * from './command'
export * from './types'
export * from './utils'