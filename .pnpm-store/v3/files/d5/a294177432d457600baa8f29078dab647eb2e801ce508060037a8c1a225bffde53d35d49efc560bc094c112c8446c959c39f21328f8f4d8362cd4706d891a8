/// <reference types="node" />
/// <reference types="node" />
import { Listener, Matcher, ToDispose, Trapper } from 'triptrap';
import { Apk, Device, Platform, ShortDevice } from "./device";
import { Config } from "../client";
declare const FN_NEXT_SEQ: unique symbol;
declare const FN_SEND: unique symbol;
declare const FN_SEND_LOGIN: unique symbol;
declare const HANDLERS: unique symbol;
declare const NET: unique symbol;
declare const ECDH: unique symbol;
declare const IS_ONLINE: unique symbol;
declare const LOGIN_LOCK: unique symbol;
declare const HEARTBEAT: unique symbol;
export declare enum VerboseLevel {
    Fatal = 0,
    Mark = 1,
    Error = 2,
    Warn = 3,
    Info = 4,
    Debug = 5
}
export declare class ApiRejection {
    code: number;
    message: string;
    constructor(code: number, message?: string);
}
export declare enum QrcodeResult {
    OtherError = 0,
    Timeout = 17,
    WaitingForScan = 48,
    WaitingForConfirm = 53,
    Canceled = 54
}
export interface BaseClient {
    uin: number;
    uid: string;
    /** 收到二维码 */
    on(name: "internal.qrcode", listener: (this: this, qrcode: Buffer) => void): ToDispose<this>;
    /** 收到滑动验证码 */
    on(name: "internal.slider", listener: (this: this, url: string) => void): ToDispose<this>;
    /** 登录保护验证 */
    on(name: "internal.verify", listener: (this: this, url: string, phone: string) => void): ToDispose<this>;
    /** token过期(此时已掉线) */
    on(name: "internal.error.token", listener: (this: this) => void): ToDispose<this>;
    /** 网络错误 */
    on(name: "internal.error.network", listener: (this: this, code: number, message: string) => void): ToDispose<this>;
    /** 密码登录相关错误 */
    on(name: "internal.error.login", listener: (this: this, code: number, message: string) => void): ToDispose<this>;
    /** 扫码登录相关错误 */
    on(name: "internal.error.qrcode", listener: (this: this, code: QrcodeResult, message: string) => void): ToDispose<this>;
    /** 登录成功 */
    on(name: "internal.online", listener: (this: this, token: Buffer, nickname: string, gender: number, age: number) => void): ToDispose<this>;
    /** token更新 */
    on(name: "internal.token", listener: (this: this, token: Buffer) => void): ToDispose<this>;
    /** 服务器强制下线 */
    on(name: "internal.kickoff", listener: (this: this, reason: string) => void): ToDispose<this>;
    /** 业务包 */
    on(name: "internal.sso", listener: (this: this, cmd: string, payload: Buffer, seq: number) => void): ToDispose<this>;
    /** 日志信息 */
    on(name: "internal.verbose", listener: (this: this, verbose: unknown, level: VerboseLevel) => void): ToDispose<this>;
    on(name: string | symbol, listener: (this: this, ...args: any[]) => void): ToDispose<this>;
}
type Packet = {
    cmd: string;
    type: number;
    callbackId?: number;
    body: Buffer;
};
export declare class BaseClient extends Trapper {
    config: Required<Config>;
    private [IS_ONLINE];
    private [LOGIN_LOCK];
    private [HEARTBEAT];
    private [ECDH];
    private readonly [NET];
    private readonly [HANDLERS];
    apk: Apk;
    readonly device: Device;
    readonly sig: Record<string, any>;
    readonly pkg: any;
    readonly pskey: {
        [domain: string]: Buffer;
    };
    readonly pt4token: {
        [domain: string]: Buffer;
    };
    /** 心跳间隔(秒) */
    protected interval: number;
    /** token刷新间隔(秒) */
    emp_interval: number;
    /** 随心跳一起触发的函数，可以随意设定 */
    protected heartbeat: () => void;
    /** token登录重试次数 */
    protected token_retry_num: number;
    /** 上线失败重试次数 */
    protected register_retry_num: number;
    protected login_timer: NodeJS.Timeout | null;
    /** 数据统计 */
    protected readonly statistics: {
        start_time: number;
        lost_times: number;
        recv_pkt_cnt: number;
        sent_pkt_cnt: number;
        lost_pkt_cnt: number;
        recv_msg_cnt: number;
        sent_msg_cnt: number;
        msg_cnt_per_min: number;
        remote_ip: string;
        remote_port: number;
        ver: string;
    };
    protected signCmd: string[];
    private ssoPacketList;
    constructor(p: Platform | undefined, d: ShortDevice, config: Required<Config>);
    /** 设置连接服务器，不设置则自动搜索 */
    setRemoteServer(host?: string, port?: number): void;
    setSignServer(addr?: string): Promise<void>;
    once(matcher: Matcher, listener: Listener): Trapper.Dispose;
    off(matcher: Matcher): void;
    emit(matcher: Matcher, ...args: any[]): void;
    /** 是否为在线状态 (可以收发业务包的状态) */
    isOnline(): boolean;
    getApkInfo(platform: Platform, ver?: string): Apk;
    getApkInfoList(platform: Platform): Apk[];
    buildReserveFields(cmd: string, sec_info: any): Buffer;
    switchQQVer(ver?: string): Promise<boolean>;
    updateCmdWhiteList(): Promise<void>;
    getCmdWhiteList(): Promise<never[]>;
    getApiQQVer(): Promise<string>;
    getT544(cmd: string): Promise<Buffer>;
    getSign(cmd: string, seq: number, body: Buffer): Promise<Buffer>;
    generateT544Packet(cmd: String, sign: Buffer): Buffer;
    generateSignPacket(sign: String, token: String, extra: String): Buffer;
    ssoPacketListHandler(list: Packet[] | null): Promise<void>;
    requestToken(): Promise<void>;
    requestSignToken(): Promise<never[]>;
    submitSsoPacket(cmd: string, callbackId: number, body: Buffer): Promise<Packet[]>;
    calcPoW(data: any): Buffer;
    /** 下线 (keepalive: 是否保持tcp连接) */
    logout(keepalive?: boolean): Promise<void>;
    /** 关闭连接 */
    terminate(): void;
    refreshToken(force?: boolean): Promise<boolean | undefined>;
    /** 使用接收到的token登录 */
    tokenLogin(token?: Buffer, cmd?: number): Promise<Buffer>;
    /**
     * 使用密码登录
     * @param uin 登录账号
     * @param md5pass 密码的md5值
     */
    passwordLogin(uin: number, md5pass: Buffer): Promise<void>;
    /** 收到滑动验证码后，用于提交滑动验证码 */
    submitSlider(ticket: string): Promise<void>;
    /** 收到设备锁验证请求后，用于发短信 */
    sendSmsCode(): Promise<void>;
    /** 提交短信验证码 */
    submitSmsCode(code: string): Promise<void>;
    /** 获取登录二维码 */
    fetchQrcode(): Promise<void>;
    /** 扫码后调用此方法登录 */
    qrcodeLogin(): Promise<void>;
    /** 获取扫码结果(可定时查询，retcode为0则调用qrcodeLogin登录) */
    queryQrcodeResult(): Promise<{
        retcode: number;
        uin: number | undefined;
        t106: Buffer | undefined;
        t16a: Buffer | undefined;
        t318: Buffer | undefined;
        tgtgt: Buffer | undefined;
    }>;
    private [FN_NEXT_SEQ];
    private [FN_SEND];
    private [FN_SEND_LOGIN];
    /** 发送一个业务包不等待返回 */
    writeUni(cmd: string, body: Uint8Array, seq?: number): Promise<void>;
    /** dont use it if not clear the usage */
    sendOidb(cmd: string, body: Uint8Array, timeout?: number): Promise<Buffer>;
    sendPacket(type: string, cmd: string, body: any): Promise<Buffer>;
    /** 发送一个业务包并等待返回 */
    sendUni(cmd: string, body: Uint8Array, timeout?: number): Promise<Buffer>;
    sendOidbSvcTrpcTcp(cmd: string, body: Uint8Array): Promise<any>;
    register(logout?: boolean, reflush?: boolean): Promise<unknown>;
    syncTimeDiff(): Promise<void>;
    token_expire(data?: any): Promise<void>;
    sendHeartbeat(): Promise<unknown>;
}
export {};
