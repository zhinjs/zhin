const path = require('path');
const fs = require('fs');
let { mode = '', config: configFile, entry } = process.env;
const entryPath = path.resolve(__dirname, entry);
const { createApp, wrapExport } = require(entryPath);
let config = wrapExport(configFile);
if (typeof config === 'function') config = config(process.env);
createApp(config).start(mode);
const errorHandler = e => console.error(e);

process.on('unhandledRejection', errorHandler);
process.on('uncaughtException', errorHandler);
