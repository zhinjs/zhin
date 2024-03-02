"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildShare = void 0;
var app;
(function (app) {
    app[app["qq"] = 100446242] = "qq";
    app[app["mi"] = 1105414497] = "mi";
    app[app["quark"] = 1105781586] = "quark";
})(app || (app = {}));
const defaultConfig = {
    appid: app.qq,
    /** 有音乐4 没音乐0 */
    // style: 4,
    appname: 'com.tencent.mtt',
    appsign: 'd8391a394d4a179e6fe7bdb8a301258b',
};
function buildShare(target, bu, content, config = {}) {
    config = { ...defaultConfig, ...config };
    return {
        1: config.appid,
        2: 1,
        3: content.audio ? 4 : 0,
        5: {
            1: 1,
            2: "0.0.0",
            3: config.appname,
            4: config.appsign
        },
        10: typeof bu === 'string' ? 3 : bu,
        11: target,
        12: {
            10: content.title,
            11: content.summary,
            12: content.content,
            13: content.url,
            14: content.image /* ?? 'https://tangram-1251316161.file.myqcloud.com/files/20210721/e50a8e37e08f29bf1ffc7466e1950690.png' */,
            16: content.audio,
        },
        19: typeof bu === 'string' ? Number(bu) : undefined
    };
}
exports.buildShare = buildShare;
