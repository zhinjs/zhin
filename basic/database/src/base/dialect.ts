// ============================================================================
// Database Dialect Interface
// ============================================================================


// ============================================================================
// SQL Builder Base Class
// ============================================================================

export abstract class Dialect<T,S extends Record<string, object>,Q> {
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
  abstract quoteIdentifier(identifier: string|number|symbol): string;
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
  abstract formatCreateTable<T extends keyof S>(tableName: T, columns: string[]): string;
  abstract formatAlterTable<T extends keyof S>(tableName: T, alterations: string[]): string;
  abstract formatDropTable<T extends keyof S>(tableName: T, ifExists?: boolean): string;
  abstract formatDropIndex<T extends keyof S>(indexName: string, tableName: T, ifExists?: boolean): string;
  abstract dispose(): Promise<void>;
}
export namespace Dialect {
  export type Creator<D,S extends Record<string, object>,Q> = (config: D) => Dialect<D,S,Q>;
  export type Constructor<D,S extends Record<string, object>,Q> = new (config: D) => Dialect<D,S,Q>;
  export type Factory<D,S extends Record<string, object>,Q> = Creator<D,S,Q> | Constructor<D,S,Q>;
  export function isConstructor<D,S extends Record<string, object>,Q>(fn: Factory<D,S,Q>): fn is Constructor<D,S,Q> {
    return fn.prototype && fn.prototype.constructor === fn;
  }
}
