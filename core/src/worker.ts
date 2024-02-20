import dotEnv from 'dotenv'
import {fork, ForkOptions} from "child_process";
import path from "path";
import * as fs from 'fs';
import { deepMerge } from '@/utils';
interface Message {
  type: "start" | "queue";
  body: any;
}

let buffer:any = null,timeStart: number;
const readEnv=(filename:string)=>{
  if(fs.existsSync(filename)){
    return dotEnv.config({path:filename}).parsed||{}
  }
  return {}
}
export function startAppWorker(config:string,mode: string) {
  const commonEnv=readEnv(path.join(process.cwd(),'.env'))
  const modeEnv=deepMerge(commonEnv,readEnv(path.join(process.cwd(),`.env.${mode}`)));
  const forkOptions: ForkOptions = {
    env: {
      ...process.env,
      mode,
      config,
      CWD:path.resolve(__dirname,'../'),
      ...modeEnv
    },
    execArgv: ["-r", "jiti/register", "-r", "tsconfig-paths/register"],
    stdio: "inherit",
  };
  const cp = fork(path.resolve(__dirname,"../start.js"), [
    '-p tsconfig.json'
  ], forkOptions)
  cp.stdout?.on("data", data => process.stdout.push(data));
  cp.stderr?.on("data", data => process.stderr.push(data));
  process.stdin?.on("data", data => cp.stdin?.write(data));
  cp.on("message", (message: Message) => {
    if (message.type === "start") {
      if (buffer) {
        cp.send({type: "send", body: buffer, times: timeStart});
        buffer = null;
      }
    } else if (message.type === "queue") {
      buffer = message.body;
    }
  });
  cp.on("exit", code => {
    if(!code) return
    if (code!==51) {
      process.exit(code);
    }
    timeStart = new Date().getTime();
    startAppWorker(config,mode)
  });
}
