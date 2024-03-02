import { FriendRequestEvent, GroupRequestEvent, GroupInviteEvent } from "../events";
type Client = import("../client").Client;
/** @cqhttp */
export declare function parseFriendRequestFlag(flag: string): {
    user_id: number;
    seq: number;
    single: boolean;
};
/** @cqhttp */
export declare function parseGroupRequestFlag(flag: string): {
    user_id: number;
    group_id: number;
    seq: number;
    invite: number;
};
export declare function getFrdSysMsg(this: Client): Promise<void>;
export declare function getGrpSysMsg(this: Client): Promise<void>;
export declare function getSysMsg(this: Client): Promise<(FriendRequestEvent | GroupInviteEvent | GroupRequestEvent)[]>;
export {};
