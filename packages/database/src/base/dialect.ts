import { 
  QueryParams, 
  BuildQueryResult, 
  CreateQueryParams, 
  SelectQueryParams, 
  InsertQueryParams, 
  UpdateQueryParams, 
  DeleteQueryParams, 
  AlterQueryParams, 
  DropTableQueryParams, 
  DropIndexQueryParams,
  AddSchema,
  ModifySchema,
  DropSchema,
  Condition,
  isCreateQuery,
  isSelectQuery,
  isInsertQuery,
  isUpdateQuery,
  isDeleteQuery,
  isAlterQuery,
  isDropTableQuery,
  isDropIndexQuery,
  Column,
} from '../types.js';

// ============================================================================
// Database Dialect Interface
// ============================================================================


// ============================================================================
// SQL Builder Base Class
// ============================================================================

export abstract class Dialect<T,Q> {
  public readonly name: string;
  public readonly config: T;
  
  protected constructor(name: string, config: T) {
    this.name = name;
    this.config = config;
  }
  
  // Abstract methods that must be implemented by concrete dialects
  abstract isConnected(): boolean;
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract healthCheck(): Promise<boolean>;
  abstract query<U = any>(query: Q, params?: any[]): Promise<U>;
  abstract mapColumnType(type: string): string;
  abstract quoteIdentifier(identifier: string): string;
  abstract getParameterPlaceholder(index: number): string;
  abstract getStatementTerminator(): string;
  abstract formatBoolean(value: boolean): string;
  abstract formatDate(value: Date): string;
  abstract formatJson(value: any): string;
  abstract escapeString(value: string): string;
  abstract formatDefaultValue(value: any): string;
  abstract formatLimit(limit: number): string;
  abstract formatOffset(offset: number): string;
  abstract formatLimitOffset(limit: number, offset: number): string;
  abstract formatCreateTable(tableName: string, columns: string[]): string;
  abstract formatAlterTable(tableName: string, alterations: string[]): string;
  abstract formatDropTable(tableName: string, ifExists?: boolean): string;
  abstract formatDropIndex(indexName: string, tableName: string, ifExists?: boolean): string;
  abstract dispose(): Promise<void>;
}
export namespace Dialect {
  export type Creator<D,Q> = (config: D) => Dialect<D,Q>;
  export type Constructor<D,Q> = new (config: D) => Dialect<D,Q>;
  export type Factory<D,Q> = Creator<D,Q> | Constructor<D,Q>;
  export function isConstructor<D,Q>(fn: Factory<D,Q>): fn is Constructor<D,Q> {
    return fn.prototype && fn.prototype.constructor === fn;
  }
}
