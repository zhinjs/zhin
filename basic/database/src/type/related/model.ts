import { Model} from '../../base/index.js';
import { RelatedDatabase } from './database.js';
import { Condition } from '../../types.js';

/**
 * 关系型模型类
 * 继承自 BaseModel，提供关系型数据库特有的操作
 */
export class RelatedModel<D=any,S extends Record<string, object> = Record<string, object>,T extends keyof S = keyof S> extends Model<D,S,string,T> {
  constructor(
    database: RelatedDatabase<D,S>,
    name: T
  ) {
    super(database, name);
  }

  /**
   * 创建数据
   */
  async create(data: Partial<S[T]>): Promise<S[T]> {
    if (!this.validateData(data)) {
      throw new Error('Invalid data provided');
    }
    try {
      const result = await this.database.insert<keyof S>(this.name, data as S[keyof S]);
      return result as S[T];
    } catch (error) {
      this.handleError(error as Error, 'create');
    }
  }

  /**
   * 批量创建数据
   */
  async createMany(data: Partial<S[T]>[]): Promise<S[T][]> {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid data array provided');
    }

    try {
      const results = [];
      for (const item of data) {
        const result = await this.create(item);
        results.push(result);
      }
      return results;
    } catch (error) {
      this.handleError(error as Error, 'createMany');
    }
  }
  /**
   * 查找单个数据
   */
  async selectOne(query?: Condition<S[T]>): Promise<S[T] | null> {
    try {
      const selection = this.select();
      if (query) {
        selection.where(query);
      }
      const results = await selection.limit(1);
      return results.length > 0 ? results[0] as S[T] : null;
    } catch (error) {
      this.handleError(error as Error, 'selectOne');
    }
  }

  /**
   * 根据ID查找
   */
  async selectById(id: any): Promise<S[T] | null> {
    return this.selectOne({ id } as Condition<S[T]>);
  }

  /**
   * 更新单个数据
   */
  async updateOne(query: Condition<S[T]>, data: Partial<S[T]>): Promise<boolean> {
    try {
      const result = await this.update(data).where(query);
      return result > 0;
    } catch (error) {
      this.handleError(error as Error, 'updateOne');
    }
  }

  /**
   * 根据ID更新
   */
  async updateById(id: any, data: Partial<S[T]>): Promise<boolean> {
    return this.updateOne({ id } as Condition<S[T]>, data);
  }


  /**
   * 根据ID删除
   */
  async deleteById(id: any): Promise<boolean> {
    const result=await this.delete({ id } as Condition<S[T]>);
    return result.length > 0;
  }

  /**
   * 统计数量
   */
  async count(query?: Condition<S[T]>): Promise<number> {
    try {
      const selection = this.select();
      if (query) {
        selection.where(query);
      }
      const results = await selection;
      return results.length;
    } catch (error) {
      this.handleError(error as Error, 'count');
    }
  }
}
