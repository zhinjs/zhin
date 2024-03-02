/// <reference types="node" />
import { FileElem } from "./message";
type Client = import("./client").Client;
/** 群文件/目录共通属性 */
export interface GfsBaseStat {
    /** 文件/目录的id (目录以/开头) */
    fid: string;
    /** 父目录id */
    pid: string;
    /** 文件/目录名 */
    name: string;
    /** 创建该文件/目录的群员账号 */
    user_id: number;
    /** 创建时间 */
    create_time: number;
    /** 最近修改时间 */
    modify_time: number;
    /** 是否为目录 */
    is_dir: boolean;
}
/** 文件属性 */
export interface GfsFileStat extends GfsBaseStat {
    /** 文件大小 */
    size: number;
    busid: number;
    md5: string;
    sha1: string;
    /** 文件存在时间 */
    duration: number;
    /** 下载次数 */
    download_times: number;
}
/** 目录属性 */
export interface GfsDirStat extends GfsBaseStat {
    /** 目录包含的文件数 */
    file_count: number;
}
/**
 * 群文件系统
 * `fid`表示一个文件或目录的id，`pid`表示它所在目录的id
 * 根目录的id为"/"
 * 只能在根目录下创建目录
 * 删除一个目录会删除下面的全部文件
 */
export declare class Gfs {
    private readonly c;
    readonly gid: number;
    /** `this.gid`的别名 */
    get group_id(): number;
    /** 返回所在群的实例 */
    get group(): import("./group").Group;
    /** 返回所属的客户端对象 */
    get client(): import("./client").Client;
    constructor(c: Client, gid: number);
    /** 获取使用空间和文件数 */
    df(): Promise<{
        /** 总空间 */
        total: number;
        /** 已使用的空间 */
        used: number;
        /** 剩余空间 */
        free: number;
    } & {
        /** 文件数 */
        file_count: number;
        /** 文件数量上限 */
        max_file_count: number;
    }>;
    private _resolve;
    /**
     * 获取文件或目录属性
     * @param fid 目标文件id
     */
    stat(fid: string): Promise<GfsFileStat | GfsDirStat>;
    /**
     * 列出`pid`目录下的所有文件和目录
     * @param pid 目标目录，默认为根目录，即`"/"`
     * @param start @todo 未知参数
     * @param limit 文件/目录上限，超过此上限就停止获取，默认`100`
     * @returns 文件和目录列表
     */
    dir(pid?: string, start?: number, limit?: number): Promise<(GfsFileStat | GfsDirStat)[]>;
    /** {@link dir} 的别名 */
    ls(pid?: string, start?: number, limit?: number): Promise<(GfsFileStat | GfsDirStat)[]>;
    /** 创建目录(只能在根目录下创建) */
    mkdir(name: string): Promise<GfsDirStat>;
    /** 删除文件/目录(删除目录会删除下面的所有文件) */
    rm(fid: string): Promise<void>;
    /**
     * 重命名文件/目录
     * @param fid 文件id
     * @param name 新命名
     */
    rename(fid: string, name: string): Promise<void>;
    /**
     * 移动文件
     * @param fid 要移动的文件id
     * @param pid 目标目录id
     */
    mv(fid: string, pid: string): Promise<void>;
    private _feed;
    /**
     * 上传一个文件
     * @param file `string`表示从该本地文件路径上传，`Buffer`表示直接上传这段内容
     * @param pid 上传的目标目录id，默认根目录
     * @param name 上传的文件名，`file`为`Buffer`时，若留空则自动以md5命名
     * @param callback 监控上传进度的回调函数，拥有一个"百分比进度"的参数
     * @returns 上传的文件属性
     */
    upload(file: string | Buffer | Uint8Array, pid?: string, name?: string, callback?: (percentage: string) => void): Promise<GfsFileStat>;
    /**
     * 将文件转发到当前群
     * @param stat 另一个群中的文件属性
     * @param pid 转发的目标目录，默认根目录
     * @param name 转发后的文件名，默认不变
     * @returns 转发的文件在当前群的属性
     */
    forward(stat: GfsFileStat, pid?: string, name?: string): Promise<GfsFileStat>;
    /**
     * 将离线(私聊)文件转发到当前群
     * @param fid 私聊文件fid
     * @param name 转发后的文件名，默认不变
     * @returns 转发的文件在当前群的属性
     */
    forwardOfflineFile(fid: string, name?: string): Promise<GfsFileStat>;
    /**
     * 获取文件下载地址
     * @param fid 文件id
     */
    download(fid: string): Promise<Omit<FileElem, "type"> & {
        url: string;
    }>;
}
export {};
