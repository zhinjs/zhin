const path = require("path");

const { configPath = "zhin.yaml", mode = "", entry } = process.env;

const errorHandler = e => console.error(e);

process.on("unhandledRejection", errorHandler);
process.on("uncaughtException", errorHandler);

entry = path.resolve(__dirname, entry || "lib");

require(entry).createZhin(path.resolve(process.cwd(), configPath)).start(mode);
