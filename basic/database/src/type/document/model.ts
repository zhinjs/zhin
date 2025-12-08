import { Model} from '../../base/index.js';
import { DocumentDatabase } from './database.js';
import { DocumentQueryResult, Condition } from '../../types.js';

/**
 * 文档型模型类
 * 继承自 Model，提供文档型数据库特有的操作
 */
export class DocumentModel<D=any, S extends Record<string, object> = Record<string, object>, T extends keyof S = keyof S> extends Model<D, S, DocumentQueryResult, T> {
  constructor(
    database: DocumentDatabase<D, S>,
    name: T
  ) {
    super(database, name);
  }

  /**
   * 创建文档
   */
  async create(document: S[T]): Promise<S[T] & { _id: string }>;
  async create(documents: S[T][]): Promise<(S[T] & { _id: string })[]>;
  async create(documents: S[T] | S[T][]): Promise<(S[T] & { _id: string }) | (S[T] & { _id: string })[]> {
    const isArray = Array.isArray(documents);
    const docs = isArray ? documents : [documents];
    
    const results = [];
    for (const doc of docs) {
      const _id = this.generateId();
      const docWithId = { ...doc, _id };
      
      await this.dialect.query(
        {
          operation: 'insertOne',
          filter: {},
          projection: {},
          collection: this.name as string,
        },
        [docWithId]
      );
      results.push(docWithId);
    }
    
    return isArray ? results : results[0];
  }

  /**
   * 查找单个文档
   */
  async selectOne<K extends keyof S[T]>(...fields: Array<K>): Promise<(Pick<S[T], K> & { _id: string }) | null> {
    const results = await this.select(...fields).limit(1);
    return results.length > 0 ? results[0] as (Pick<S[T], K> & { _id: string }) : null;
  }

  /**
   * 根据ID查找文档
   */
  async selectById(id: string){
    return this.select('_id' as any).where({
      _id: id,
    } as Condition<S[T]>).limit(1).then((results: any) => results[0] || null);
  }
  /**
   * 根据ID更新文档
   */
  async updateById(id: string, update: Partial<S[T]>): Promise<number> {
    return this.update(update).where({
      _id: id,
    } as Condition<S[T]>)
  }

  /**
   * 根据ID删除文档
   */
  async deleteById(id: string): Promise<S[T][]> {
    return this.delete({
      _id: id,
    } as Condition<S[T]>)
  }

  /**
   * 生成文档ID
   */
  private generateId(): string {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }
}