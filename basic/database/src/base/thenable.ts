import type { Database } from "./database.js";
import type { Dialect } from "./dialect.js";
import { QueryParams } from "../types.js";


export abstract class ThenableQuery<T = any,C=any,D=string>
  implements PromiseLike<T>, AsyncIterable<T>
{
  protected constructor(protected readonly database: Database<C,Record<string, object>,D>,protected readonly dialect: Dialect<C,D>) {}
  
  // Abstract method to get query parameters
  protected abstract getQueryParams(): QueryParams;
  [Symbol.toStringTag] = 'ThenableQuery';
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): Promise<TResult1 | TResult2> {
    const params = this.getQueryParams();
    const { query, params: queryParams } = this.database.buildQuery(params);
    return this.dialect.query<T>(query, queryParams).then(onfulfilled, onrejected);
  }
  
  catch<TResult = never>(
    onrejected?:
      | ((reason: any) => TResult | PromiseLike<TResult>)
      | undefined
      | null
  ): Promise<any | TResult> {
    const params = this.getQueryParams();
    const { query, params: queryParams } = this.database.buildQuery(params);
    return this.dialect.query(query, queryParams).catch(onrejected);
  }
  
  finally(onfinally?: (() => void) | undefined | null): Promise<any> {
    const params = this.getQueryParams();
    const { query, params: queryParams } = this.database.buildQuery(params);
    return this.dialect.query(query, queryParams).finally(onfinally);
  }
  
  async *[Symbol.asyncIterator](): AsyncIterator<T, void, unknown> {
    const params = this.getQueryParams();
    const { query, params: queryParams } = this.database.buildQuery(params);
    const rows = await this.dialect.query(query, queryParams);
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      yield row;
    }
  }
}