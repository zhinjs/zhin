import {fork} from "child_process";
import {join,resolve} from 'path'
import * as fs from 'fs'
import * as Yaml from 'js-yaml'
import {Bot} from "@/bot";
export function createWorker(config:Bot.Config|string='zhing.yaml'){
    if(typeof config!=='string') fs.writeFileSync(join(process.cwd(),'zhing.yaml'),Yaml.dump(config))
    return fork(join(__dirname,'worker.ts'),[
        '-r',
        'esbuild-register',
        '-r',
        'tsconfig-paths/register'
    ],{
        env:{
            configPath:resolve(process.cwd(),typeof config==='string'?config:'zhing.yaml')
        }
    })
}
export * from './argv'
export * from './bot'
export * from './command'
export * from './types'
export * from './utils'
export * from './worker'