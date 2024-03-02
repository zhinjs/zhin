/// <reference types="node" />
import { CompilerOptions } from 'typescript';
import { ForkOptions } from 'child_process';
export declare class TsConfig {
    cwd: string;
    args: string[];
    extends?: string;
    files?: string[];
    references?: TsConfig.Reference[];
    compilerOptions: CompilerOptions;
    constructor(cwd: string, args: string[]);
    private index;
    get(key: string, fallback: string): string;
    get<K extends string>(key: K): CompilerOptions[K];
    set(key: string, value: string, override?: boolean): void;
}
export declare namespace TsConfig {
    interface Reference {
        path: string;
    }
}
export declare function read(filename: string): Promise<TsConfig>;
export declare function load(cwd: string, args?: string[]): Promise<TsConfig>;
export declare function compile(args: string[], options?: ForkOptions): Promise<number>;
