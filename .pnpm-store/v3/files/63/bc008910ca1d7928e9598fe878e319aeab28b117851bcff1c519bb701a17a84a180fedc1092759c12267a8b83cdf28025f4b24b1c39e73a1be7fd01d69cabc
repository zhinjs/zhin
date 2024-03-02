export type MatcherFn = (...args: any[]) => boolean;
export type Matcher = string | symbol | RegExp | MatcherFn;
export type Dispose = () => boolean | void;
export type ToDispose<T> = T & Dispose;
export declare namespace Dispose {
    function from<T extends object>(source: T, callback: any): ToDispose<T>;
}
export declare class Trapper {
    private matchers;
    constructor();
    private getListeners;
    listeners(matcher?: Matcher): Trapper.Listener[];
    trap(matcher: Matcher, listener: Trapper.Listener): ToDispose<this>;
    addMatcher<T extends Trapper = this>(this: T, matcher: Matcher, listener: Trapper.Listener): ToDispose<T>;
    trapOnce(matcher: Matcher, listener: Trapper.Listener): Trapper.Dispose;
    offTrap(matcher: Matcher, listener?: Trapper.Listener): void;
    tripAsync(matcher: Matcher, ...args: any[]): Promise<void>;
    trip(matcher: Matcher, ...args: any[]): void;
    bailSync(matcher: Matcher, ...args: any[]): Promise<any>;
    bail(matcher: Matcher, ...args: any[]): any;
    private getMatchers;
}
export interface TripTrapper {
    matchers: Map<MatcherFn, Listener>;
    addMatcher(matcher: Matcher, listener: Listener): TripTrapper;
    trap(matcher: Matcher, listener: Listener): TripTrapper;
    trip(eventName: string | symbol, ...args: any[]): void;
    tripAsync(eventName: string | symbol, ...args: any[]): Promise<void>;
    bail<T = any>(eventName: string | symbol, ...args: any[]): T;
    bailAsync<T = any>(eventName: string | symbol, ...args: any[]): Promise<T>;
    listeners(matcher: Matcher): Listener[];
    delete(matcher: Matcher, listener?: Listener): TripTrapper;
    clean(): TripTrapper;
}
export interface Listener {
    (...args: any[]): any;
}
export declare function defineTripTrap(): TripTrapper;
export declare namespace Trapper {
    type Listener = (...args: any[]) => any;
    type Dispose = (() => void) & Trapper;
    function isPromise(object: unknown): object is Promise<unknown>;
    function createMatcherFn(eventName: string | symbol | RegExp): MatcherFn;
}
export default Trapper;
