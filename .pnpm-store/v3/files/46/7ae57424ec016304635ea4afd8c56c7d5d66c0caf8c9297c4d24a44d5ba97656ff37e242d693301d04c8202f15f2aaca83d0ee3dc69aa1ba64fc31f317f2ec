/// <reference types="node" />
import { Socket } from "net";
/**
 * @event connect2
 * @event packet
 * @event lost
 */
export default class Network extends Socket {
    host: string;
    port: number;
    auto_search: boolean;
    connected: boolean;
    private buf;
    constructor();
    join(cb?: () => void): void;
    private resolve;
}
/** 通常来说只有前两个ip比较稳定，后面的可能距离较远 */
export declare function fetchServerList(): Promise<{
    [ip: string]: number;
}>;
