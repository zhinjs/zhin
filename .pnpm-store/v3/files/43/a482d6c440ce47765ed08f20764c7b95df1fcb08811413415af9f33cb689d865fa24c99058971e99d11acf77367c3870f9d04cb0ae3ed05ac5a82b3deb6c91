"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
async function getT544(...cmds) {
    if (this.apk.display === 'Android_8.8.88')
        return;
    if (!this.sig.t544)
        this.sig.t544 = {};
    await Promise.all(cmds.map(async (cmd) => {
        const { data: { data, code } } = await axios_1.default.get('http://icqq.tencentola.com/txapi/8.9.50/energy', {
            timeout: 5000,
            params: {
                version: this.apk.sdkver,
                uin: this.uin,
                guid: this.device.guid.toString('hex'),
                data: cmd,
            }
        }).catch(() => ({ data: { code: -1 } }));
        if (code === 0) {
            this.sig.t544[cmd] = Buffer.from(data, 'hex');
        }
    }));
}
