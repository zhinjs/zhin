const path = require("path");
const fs = require('fs')
let { mode = "",config:configFile,...other } = process.env;
const entry = path.resolve(__dirname, "lib");
const {createApp,wrapExport} = require(entry)
let config=wrapExport(configFile)
if(typeof config==='function') config=config(process.env)
createApp(config)
	.start()
const errorHandler = e => console.error(e);

process.on("unhandledRejection", errorHandler);
process.on("uncaughtException", errorHandler);
