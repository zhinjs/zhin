declare module 'ioredis' {
  class Redis {
    constructor(url: string, options?: { maxRetriesPerRequest?: number });
    hkeys(key: string): Promise<string[]>;
    hget(key: string, field: string): Promise<string | null>;
    hmget(key: string, ...fields: string[]): Promise<(string | null)[]>;
    hset(key: string, field: string, value: string): Promise<number>;
    hdel(key: string, field: string): Promise<number>;
    zadd(key: string, ...args: (number | string)[]): Promise<number>;
    zrem(key: string, member: string): Promise<number>;
    zrangebyscore(key: string, min: number | string, max: number | string, ...args: (string | number)[]): Promise<string[]>;
    set(key: string, value: string, mode: string, ttl: number, flag: string): Promise<string | null>;
    get(key: string): Promise<string | null>;
    del(key: string): Promise<number>;
    eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
    quit(): Promise<string>;
  }
  export default Redis;
}
