#!/usr/bin/env node
import {createWorker} from "./zhin";
const configPath=process.argv.splice(2)[0]||'zhin.yaml'
createWorker(configPath)