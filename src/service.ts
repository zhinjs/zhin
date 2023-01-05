#!/usr/bin/env node
import {createWorker} from "@/app";
const configPath=process.argv.splice(2)[0]||'zhin.yaml'
createWorker(configPath)