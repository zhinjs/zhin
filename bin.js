#!/usr/bin/env node

"use strict";

const path = require("path");
const parse = require("yargs-parser");

const argv = parse(process.argv?.slice(2), {
    alias: {
        config: ["c"],
        entry: ["e"],
        dev: ["d"],
    },
});

if (argv.dev) {
    argv.mode = "dev";
}

const entry = path.resolve(__dirname, argv.entry || "lib");

require(entry).createWorker(argv);
