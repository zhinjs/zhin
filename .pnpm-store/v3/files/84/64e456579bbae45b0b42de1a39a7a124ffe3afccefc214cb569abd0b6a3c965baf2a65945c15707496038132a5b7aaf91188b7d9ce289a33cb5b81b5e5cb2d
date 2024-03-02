"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDuration = exports.decode = exports.encode = void 0;
const worker_threads_1 = require("worker_threads");
const silk_wasm_1 = require("silk-wasm");
const fs_1 = __importDefault(require("fs"));
if (!worker_threads_1.isMainThread && worker_threads_1.parentPort) {
    worker_threads_1.parentPort.once('message', (val) => {
        const data = val.data;
        const port = val.port;
        const input = data.input || Buffer.alloc(0);
        if (data.file)
            fs_1.default.unlink(data.file, () => { });
        switch (data.type) {
            case "encode":
                (0, silk_wasm_1.encode)(input, data.sampleRate).then(ret => {
                    port.postMessage(ret);
                    port.close();
                });
                break;
            case "decode":
                (0, silk_wasm_1.decode)(input, data.sampleRate).then(ret => {
                    port.postMessage(ret);
                    port.close();
                });
                break;
            case "getDuration":
                port.postMessage((0, silk_wasm_1.getDuration)(input, data.frameMs));
                port.close();
                break;
            default:
                port.postMessage({ data: null });
                port.close();
        }
    });
}
function postMessage(data) {
    const worker = new worker_threads_1.Worker(__filename);
    const subChannel = new worker_threads_1.MessageChannel();
    const port = subChannel.port2;
    return new Promise(resolve => {
        port.once('message', (ret) => {
            port.close();
            worker.terminate();
            resolve(ret);
        });
        worker.postMessage({ port: subChannel.port1, data: data }, [subChannel.port1]);
    });
}
function file(input) {
    if (typeof (input) === 'string') {
        input = fs_1.default.readFileSync(input);
    }
    return input;
}
function encode(input, sampleRate) {
    return postMessage({ type: 'encode', input: file(input), sampleRate });
}
exports.encode = encode;
function decode(input, sampleRate) {
    return postMessage({ type: 'decode', input: file(input), sampleRate });
}
exports.decode = decode;
function getDuration(input, frameMs) {
    return postMessage({ type: 'getDuration', input: file(input), frameMs });
}
exports.getDuration = getDuration;
