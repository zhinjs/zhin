import type { Database } from "./database.js";
import type { Dialect } from "./dialect.js";
import { QueryParams } from "../types.js";


export abstract class ThenableQuery<R,S extends Record<string, object>, T extends keyof S,C=any,D=string>
  implements PromiseLike<R>, AsyncIterable<R>
{
  protected constructor(protected readonly database: Database<C,S,D>,protected readonly dialect: Dialect<C,S,D>) {}
  
  // Abstract method to get query parameters
  protected abstract getQueryParams(): QueryParams<S,T>;
  [Symbol.toStringTag] = 'ThenableQuery';
  then<TResult1 = R, TResult2 = never>(
    onfulfilled?:
      | ((value: R) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): Promise<TResult1 | TResult2> {
    const params = this.getQueryParams();
    const { query, params: queryParams } = this.database.buildQuery(params);
    // 使用 database.query 以支持日志记录
    return this.database.query<R>(query, queryParams).then(onfulfilled, onrejected);
  }
  
  catch<TResult = never>(
    onrejected?:
      | ((reason: any) => TResult | PromiseLike<TResult>)
      | undefined
      | null
  ): Promise<any | TResult> {
    const params = this.getQueryParams();
    const { query, params: queryParams } = this.database.buildQuery(params);
    return this.database.query(query, queryParams).catch(onrejected);
  }
  
  finally(onfinally?: (() => void) | undefined | null): Promise<any> {
    const params = this.getQueryParams();
    const { query, params: queryParams } = this.database.buildQuery(params);
    return this.database.query(query, queryParams).finally(onfinally);
  }
  
  async *[Symbol.asyncIterator](): AsyncIterator<R, void, unknown> {
    const params = this.getQueryParams();
    const { query, params: queryParams } = this.database.buildQuery(params);
    const rows = await this.database.query(query, queryParams);
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      yield row;
    }
  }
}