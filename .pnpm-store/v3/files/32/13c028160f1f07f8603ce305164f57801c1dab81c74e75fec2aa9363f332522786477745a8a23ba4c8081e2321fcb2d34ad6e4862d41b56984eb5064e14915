/// <reference types="node" />
/** 生成短设备信息 */
export declare function generateShortDevice(): {
    "--begin--": string;
    product: string;
    device: string;
    board: string;
    brand: string;
    model: string;
    wifi_ssid: string;
    bootloader: string;
    display: string;
    boot_id: string;
    proc_version: string;
    mac_address: string;
    ip_address: string;
    android_id: string;
    incremental: string;
    "--end--": string;
};
/** 生成完整设备信息 */
export declare function generateFullDevice(apk: Apk, d?: ShortDevice): {
    display: string;
    product: string;
    device: string;
    board: string;
    brand: string;
    model: string;
    bootloader: string;
    fingerprint: string;
    boot_id: string;
    proc_version: string;
    baseband: string;
    sim: string;
    os_type: string;
    mac_address: string;
    ip_address: string;
    wifi_bssid: string;
    wifi_ssid: string;
    imei: string;
    android_id: string;
    apn: string;
    version: {
        incremental: string;
        release: string;
        codename: string;
        sdk: number;
    };
    imsi: Buffer;
    guid: Buffer;
};
export type ShortDevice = ReturnType<typeof generateShortDevice>;
export interface Device extends ReturnType<typeof generateFullDevice> {
    qImei16?: string;
    qImei36?: string;
    mtime?: number;
}
export declare class Device {
    apk: Apk;
    private secret;
    private publicKey;
    constructor(apk: Apk, d?: ShortDevice);
    getQIMEI(): Promise<void>;
    genRandomPayloadByDevice(): {
        androidId: string;
        platformId: number;
        appKey: string;
        appVersion: string;
        beaconIdSrc: string;
        brand: string;
        channelId: string;
        cid: string;
        imei: string;
        imsi: string;
        mac: string;
        model: string;
        networkType: string;
        oaid: string;
        osVersion: string;
        qimei: string;
        qimei36: string;
        sdkVersion: string;
        targetSdkVersion: string;
        audit: string;
        userId: string;
        packageId: string;
        deviceType: string;
        sdkName: string;
        reserved: string;
    };
}
/**
 * 支持的登录设备平台
 * * `aPad`和`Watch`协议无法设置在线状态、无法接收某些群事件（包括戳一戳等）
 * * 目前仅`Watch`支持扫码登录，可能会支持`iPad`扫码登录
 */
export declare enum Platform {
    /** 安卓手机 */
    Android = 1,
    /** 安卓平板 */
    aPad = 2,
    /** 安卓手表 */
    Watch = 3,
    /** MacOS */
    iMac = 4,
    /** iPad */
    iPad = 5,
    /** Tim */
    Tim = 6
}
/** 登录设备通用属性 */
export type Apk = {
    id: string;
    app_key: string;
    name: string;
    version: string;
    ver: string;
    sign: Buffer;
    buildtime: number;
    appid: number;
    subid: number;
    apad_subid?: number;
    bitmap: number;
    main_sig_map: number;
    sub_sig_map: number;
    sdkver: string;
    display: string;
    /** 用于扫码登录 */
    device_type: number;
    qua: string;
    ssover: number;
};
export declare function getApkInfoList(p: Platform): Apk[];
