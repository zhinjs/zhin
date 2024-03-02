"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginErrorCode = exports.drop = exports.ErrorCode = void 0;
const core_1 = require("./core");
/** 调用API时可能出现的错误 */
var ErrorCode;
(function (ErrorCode) {
    /** 客户端离线 */
    ErrorCode[ErrorCode["ClientNotOnline"] = -1] = "ClientNotOnline";
    /** 发包超时未收到服务器回应 */
    ErrorCode[ErrorCode["PacketTimeout"] = -2] = "PacketTimeout";
    /** 用户不存在 */
    ErrorCode[ErrorCode["UserNotExists"] = -10] = "UserNotExists";
    /** 群不存在(未加入) */
    ErrorCode[ErrorCode["GroupNotJoined"] = -20] = "GroupNotJoined";
    /** 群员不存在 */
    ErrorCode[ErrorCode["MemberNotExists"] = -30] = "MemberNotExists";
    /** 发消息时传入的参数不正确 */
    ErrorCode[ErrorCode["MessageBuilderError"] = -60] = "MessageBuilderError";
    /** 群消息被风控发送失败 */
    ErrorCode[ErrorCode["RiskMessageError"] = -70] = "RiskMessageError";
    /** 群消息有敏感词发送失败 */
    ErrorCode[ErrorCode["SensitiveWordsError"] = -80] = "SensitiveWordsError";
    /** 上传图片/文件/视频等数据超时 */
    ErrorCode[ErrorCode["HighwayTimeout"] = -110] = "HighwayTimeout";
    /** 上传图片/文件/视频等数据遇到网络错误 */
    ErrorCode[ErrorCode["HighwayNetworkError"] = -120] = "HighwayNetworkError";
    /** 没有上传通道 */
    ErrorCode[ErrorCode["NoUploadChannel"] = -130] = "NoUploadChannel";
    /** 不支持的file类型(没有流) */
    ErrorCode[ErrorCode["HighwayFileTypeError"] = -140] = "HighwayFileTypeError";
    /** 文件安全校验未通过不存在 */
    ErrorCode[ErrorCode["UnsafeFile"] = -150] = "UnsafeFile";
    /** 离线(私聊)文件不存在 */
    ErrorCode[ErrorCode["OfflineFileNotExists"] = -160] = "OfflineFileNotExists";
    /** 群文件不存在(无法转发) */
    ErrorCode[ErrorCode["GroupFileNotExists"] = -170] = "GroupFileNotExists";
    /** 获取视频中的图片失败 */
    ErrorCode[ErrorCode["FFmpegVideoThumbError"] = -210] = "FFmpegVideoThumbError";
    /** 音频转换失败 */
    ErrorCode[ErrorCode["FFmpegPttTransError"] = -220] = "FFmpegPttTransError";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
const ErrorMessage = {
    [ErrorCode.UserNotExists]: "查无此人",
    [ErrorCode.GroupNotJoined]: "未加入的群",
    [ErrorCode.MemberNotExists]: "幽灵群员",
    [ErrorCode.RiskMessageError]: "群消息发送失败，可能被风控",
    [ErrorCode.SensitiveWordsError]: "群消息发送失败，请检查消息内容",
    10: "消息过长",
    34: "消息过长",
    120: "在该群被禁言",
    121: "AT全体剩余次数不足",
};
function drop(code, message) {
    if (!message || !message.length)
        message = ErrorMessage[code];
    throw new core_1.ApiRejection(code, message);
}
exports.drop = drop;
/** 登录时可能出现的错误，不在列的都属于未知错误，暂时无法解决 */
var LoginErrorCode;
(function (LoginErrorCode) {
    /** 密码错误 */
    LoginErrorCode[LoginErrorCode["WrongPassword"] = 1] = "WrongPassword";
    /** 账号被冻结 */
    LoginErrorCode[LoginErrorCode["AccountFrozen"] = 40] = "AccountFrozen";
    /** 发短信太频繁 */
    LoginErrorCode[LoginErrorCode["TooManySms"] = 162] = "TooManySms";
    /** 短信验证码错误 */
    LoginErrorCode[LoginErrorCode["WrongSmsCode"] = 163] = "WrongSmsCode";
    /** 滑块ticket错误 */
    LoginErrorCode[LoginErrorCode["WrongTicket"] = 237] = "WrongTicket";
})(LoginErrorCode || (exports.LoginErrorCode = LoginErrorCode = {}));
