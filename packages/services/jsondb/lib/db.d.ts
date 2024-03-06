export declare class JsonDB {
    private readonly filePath;
    private data;
    constructor(filePath: string);
    private init;
    private write;
    private read;
    findIndex<T>(route: string, predicate: (value: T, index: number, obj: T[]) => unknown): number;
    indexOf<T>(route: string, item: T): number;
    get<T>(route: string, initialValue?: T): T | undefined;
    set<T>(route: string, data: T): T;
    delete(route: string): boolean;
    private getArray;
    unshift<T>(route: string, ...data: T[]): number;
    shift<T>(route: string): T | undefined;
    push<T>(route: string, ...data: T[]): number;
    pop<T>(route: string): T | undefined;
    splice<T>(route: string, index?: number, deleteCount?: number, ...data: T[]): T[];
    find<T>(route: string, callback: (item: T, index: number) => boolean): T | undefined;
    filter<T>(route: string, callback: (item: T, index: number) => boolean): T[];
}
