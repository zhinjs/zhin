import {createBot} from "@/bot";
import {resolve} from 'path'
createBot(process.env.configPath||resolve(process.cwd(),'zhin.yaml')).start()