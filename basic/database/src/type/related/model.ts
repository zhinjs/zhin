import { Model} from '../../base/index.js';
import { RelatedDatabase } from './database.js';
import { Condition, ModelOptions, RelationDefinition } from '../../types.js';

/**
 * 关联查询构建器
 * 支持链式调用预加载关联数据
 */
export class RelationQueryBuilder<
  D = any,
  S extends Record<string, object> = Record<string, object>,
  T extends keyof S = keyof S
> {
  private conditions: Condition<S[T]> = {};
  private orderings: { field: keyof S[T]; direction: 'ASC' | 'DESC' }[] = [];
  private limitCount?: number;
  private offsetCount?: number;
  private selectedFields?: (keyof S[T])[];
  
  constructor(
    private readonly model: RelatedModel<D, S, T>,
    private readonly relationNames: string[]
  ) {}
  
  /**
   * 选择字段
   */
  select<K extends keyof S[T]>(...fields: K[]): this {
    this.selectedFields = fields;
    return this;
  }
  
  /**
   * 添加查询条件
   */
  where(condition: Condition<S[T]>): this {
    this.conditions = { ...this.conditions, ...condition };
    return this;
  }
  
  /**
   * 排序
   */
  orderBy(field: keyof S[T], direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.orderings.push({ field, direction });
    return this;
  }
  
  /**
   * 限制数量
   */
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }
  
  /**
   * 偏移量
   */
  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }
  
  /**
   * 执行查询并加载关联
   */
  async then<TResult = (S[T] & { [key: string]: any })[]>(
    onfulfilled?: (value: (S[T] & { [key: string]: any })[]) => TResult | PromiseLike<TResult>
  ): Promise<TResult> {
    // 构建主查询
    let selection = this.model.select(...(this.selectedFields || []));
    
    if (Object.keys(this.conditions).length > 0) {
      selection = selection.where(this.conditions);
    }
    
    for (const { field, direction } of this.orderings) {
      selection = selection.orderBy(field, direction);
    }
    
    if (this.limitCount !== undefined) {
      selection = selection.limit(this.limitCount);
    }
    
    if (this.offsetCount !== undefined) {
      selection = selection.offset(this.offsetCount);
    }
    
    // 执行主查询
    const records = await selection as S[T][];
    
    // 加载关联
    const result = await this.model.loadRelations(records, this.relationNames);
    
    return onfulfilled ? onfulfilled(result) : result as any;
  }
}

/**
 * 关系型模型类
 * 继承自 BaseModel，提供关系型数据库特有的操作
 * 
 * @example
 * ```ts
 * // 创建带软删除的模型
 * const userModel = new RelatedModel(db, 'users', { softDelete: true });
 * 
 * // 删除（实际执行 UPDATE SET deletedAt = NOW()）
 * await userModel.delete({ id: 1 });
 * 
 * // 查询（自动排除已删除）
 * await userModel.select('id', 'name');
 * 
 * // 查询包含已删除
 * await userModel.selectWithTrashed('id', 'name');
 * 
 * // 恢复已删除
 * await userModel.restore({ id: 1 });
 * ```
 */
export class RelatedModel<D=any,S extends Record<string, object> = Record<string, object>,T extends keyof S = keyof S> extends Model<D,S,string,T> {
  /** 关系定义存储 */
  private relations = new Map<string, RelationDefinition<S, T, keyof S>>();
  
  constructor(
    database: RelatedDatabase<D,S>,
    name: T,
    options?: ModelOptions
  ) {
    super(database, name, options);
  }
  
  // ============================================================================
  // 关系定义方法
  // ============================================================================
  
  /**
   * 定义一对多关系
   * @param targetModel 目标模型实例
   * @param foreignKey 目标表中的外键字段
   * @param localKey 本表的主键字段（默认 'id'）
   * @example
   * ```ts
   * const userModel = db.model('users');
   * const orderModel = db.model('orders');
   * 
   * // User hasMany Orders (orders.userId -> users.id)
   * userModel.hasMany(orderModel, 'userId');
   * ```
   */
  hasMany<To extends keyof S>(
    targetModel: RelatedModel<D, S, To>,
    foreignKey: keyof S[To],
    localKey: keyof S[T] = 'id' as keyof S[T]
  ): this {
    const relationName = String(targetModel.name);
    this.relations.set(relationName, {
      type: 'hasMany',
      target: targetModel.name,
      foreignKey: foreignKey as any,
      localKey,
    } as RelationDefinition<S, T, keyof S>);
    return this;
  }
  
  /**
   * 定义多对一关系
   * @param targetModel 目标模型实例
   * @param foreignKey 本表中的外键字段
   * @param targetKey 目标表的主键字段（默认 'id'）
   * @example
   * ```ts
   * const userModel = db.model('users');
   * const orderModel = db.model('orders');
   * 
   * // Order belongsTo User (orders.userId -> users.id)
   * orderModel.belongsTo(userModel, 'userId');
   * ```
   */
  belongsTo<To extends keyof S>(
    targetModel: RelatedModel<D, S, To>,
    foreignKey: keyof S[T],
    targetKey: keyof S[To] = 'id' as keyof S[To]
  ): this {
    const relationName = String(targetModel.name);
    this.relations.set(relationName, {
      type: 'belongsTo',
      target: targetModel.name,
      foreignKey,
      targetKey: targetKey as any,
    } as RelationDefinition<S, T, keyof S>);
    return this;
  }
  
  /**
   * 定义一对一关系
   * @param targetModel 目标模型实例
   * @param foreignKey 目标表中的外键字段
   * @param localKey 本表的主键字段（默认 'id'）
   * @example
   * ```ts
   * const userModel = db.model('users');
   * const profileModel = db.model('profiles');
   * 
   * // User hasOne Profile (profiles.userId -> users.id)
   * userModel.hasOne(profileModel, 'userId');
   * ```
   */
  hasOne<To extends keyof S>(
    targetModel: RelatedModel<D, S, To>,
    foreignKey: keyof S[To],
    localKey: keyof S[T] = 'id' as keyof S[T]
  ): this {
    const relationName = String(targetModel.name);
    this.relations.set(relationName, {
      type: 'hasOne',
      target: targetModel.name,
      foreignKey: foreignKey as any,
      localKey,
    } as RelationDefinition<S, T, keyof S>);
    return this;
  }
  
  /**
   * 定义多对多关系
   * @param targetModel 目标模型实例
   * @param pivotTable 中间表名
   * @param foreignPivotKey 中间表中指向本表的外键
   * @param relatedPivotKey 中间表中指向目标表的外键
   * @param localKey 本表的主键字段（默认 'id'）
   * @param relatedKey 目标表的主键字段（默认 'id'）
   * @example
   * ```ts
   * const userModel = db.model('users');
   * const roleModel = db.model('roles');
   * 
   * // User belongsToMany Roles (通过 user_roles 中间表)
   * userModel.belongsToMany(roleModel, 'user_roles', 'user_id', 'role_id');
   * 
   * // 双向关系
   * roleModel.belongsToMany(userModel, 'user_roles', 'role_id', 'user_id');
   * ```
   */
  belongsToMany<To extends keyof S>(
    targetModel: RelatedModel<D, S, To>,
    pivotTable: string,
    foreignPivotKey: string,
    relatedPivotKey: string,
    localKey: keyof S[T] = 'id' as keyof S[T],
    relatedKey: keyof S[To] = 'id' as keyof S[To],
    pivotFields?: string[]
  ): this {
    const relationName = String(targetModel.name);
    this.relations.set(relationName, {
      type: 'belongsToMany',
      target: targetModel.name,
      foreignKey: localKey,
      targetKey: relatedKey,
      localKey,
      pivot: {
        table: pivotTable,
        foreignPivotKey,
        relatedPivotKey,
        pivotFields,
      },
    } as RelationDefinition<S, T, keyof S>);
    return this;
  }
  
  /**
   * 获取关系定义
   */
  getRelation(name: string): RelationDefinition<S, T, keyof S> | undefined {
    return this.relations.get(name);
  }
  
  /**
   * 获取所有关系名称
   */
  getRelationNames(): string[] {
    return Array.from(this.relations.keys());
  }
  
  // ============================================================================
  // 关系查询方法
  // ============================================================================
  
  /**
   * 加载单条记录的关联数据
   * @example
   * ```ts
   * const user = await userModel.selectById(1);
   * const userWithPosts = await userModel.loadRelation(user, 'posts');
   * // userWithPosts.posts = [{ id: 1, title: '...' }, ...]
   * ```
   */
  async loadRelation<RelName extends string, To extends keyof S>(
    record: S[T],
    relationName: RelName
  ): Promise<S[T] & { [K in RelName]: S[To][] | S[To] | null }> {
    const relation = this.relations.get(relationName);
    if (!relation) {
      throw new Error(`Relation "${relationName}" not defined on model "${String(this.name)}"`);
    }
    
    const relatedData = await this.fetchRelatedData(record, relation);
    
    return {
      ...record,
      [relationName]: relatedData,
    } as S[T] & { [K in RelName]: S[To][] | S[To] | null };
  }
  
  /**
   * 批量加载关联数据（预加载）
   * @example
   * ```ts
   * const users = await userModel.select('id', 'name');
   * const usersWithPosts = await userModel.loadRelations(users, ['posts']);
   * ```
   */
  async loadRelations<RelNames extends string>(
    records: S[T][],
    relationNames: RelNames[]
  ): Promise<(S[T] & { [K in RelNames]?: any })[]> {
    if (records.length === 0) return [];
    
    const result = [...records] as (S[T] & { [K in RelNames]?: any })[];
    
    for (const relationName of relationNames) {
      const relation = this.relations.get(relationName);
      if (!relation) {
        throw new Error(`Relation "${relationName}" not defined on model "${String(this.name)}"`);
      }
      
      await this.batchLoadRelation(result, relationName, relation);
    }
    
    return result;
  }
  
  /**
   * 带关联的查询（链式调用入口）
   * @example
   * ```ts
   * const users = await userModel.with('posts', 'profile')
   *   .where({ status: 'active' });
   * ```
   */
  with(...relationNames: string[]): RelationQueryBuilder<D, S, T> {
    return new RelationQueryBuilder(this, relationNames);
  }
  
  // ============================================================================
  // 内部方法
  // ============================================================================
  
  /**
   * 获取单条记录的关联数据
   */
  private async fetchRelatedData(
    record: S[T],
    relation: RelationDefinition<S, T, keyof S>
  ): Promise<any> {
    const targetDb = this.database as RelatedDatabase<D, S>;
    
    switch (relation.type) {
      case 'hasMany': {
        const localValue = (record as any)[relation.localKey || 'id'];
        const results = await targetDb.select(relation.target, [])
          .where({ [relation.foreignKey]: localValue } as any);
        return results;
      }
      
      case 'hasOne': {
        const localValue = (record as any)[relation.localKey || 'id'];
        const results = await targetDb.select(relation.target, [])
          .where({ [relation.foreignKey]: localValue } as any)
          .limit(1);
        return results.length > 0 ? results[0] : null;
      }
      
      case 'belongsTo': {
        const foreignValue = (record as any)[relation.foreignKey];
        if (foreignValue === null || foreignValue === undefined) {
          return null;
        }
        const results = await targetDb.select(relation.target, [])
          .where({ [relation.targetKey || 'id']: foreignValue } as any)
          .limit(1);
        return results.length > 0 ? results[0] : null;
      }
      
      case 'belongsToMany': {
        if (!relation.pivot) {
          throw new Error('belongsToMany relation requires pivot configuration');
        }
        
        const localKey = relation.localKey || 'id';
        const localValue = (record as any)[localKey];
        const { table: pivotTable, foreignPivotKey, relatedPivotKey, pivotFields } = relation.pivot;
        const targetKey = relation.targetKey || 'id';
        
        // 查询中间表获取关联的目标ID
        const pivotRecords = await targetDb.query<any[]>(
          `SELECT * FROM "${pivotTable}" WHERE "${foreignPivotKey}" = ?`,
          [localValue]
        );
        
        if (pivotRecords.length === 0) {
          return [];
        }
        
        // 获取目标表数据
        const relatedIds = pivotRecords.map(p => p[relatedPivotKey]);
        const relatedRecords = await targetDb.select(relation.target, [])
          .where({ [targetKey]: { $in: relatedIds } } as any);
        
        // 如果需要包含 pivot 数据，将其附加到每条记录
        if (pivotFields && pivotFields.length > 0) {
          const pivotMap = new Map<any, any>();
          pivotRecords.forEach(p => pivotMap.set(p[relatedPivotKey], p));
          
          return relatedRecords.map(r => ({
            ...r,
            pivot: pivotMap.get((r as any)[targetKey]) || {}
          }));
        }
        
        return relatedRecords;
      }
      
      default:
        throw new Error(`Unknown relation type: ${relation.type}`);
    }
  }
  
  /**
   * 批量加载关联（优化 N+1 问题）
   */
  private async batchLoadRelation(
    records: any[],
    relationName: string,
    relation: RelationDefinition<S, T, keyof S>
  ): Promise<void> {
    const targetDb = this.database as RelatedDatabase<D, S>;
    
    switch (relation.type) {
      case 'hasMany':
      case 'hasOne': {
        // 收集所有本地主键值
        const localKey = relation.localKey || 'id';
        const localValues = records.map(r => r[localKey]).filter(v => v != null);
        
        if (localValues.length === 0) {
          records.forEach(r => r[relationName] = relation.type === 'hasMany' ? [] : null);
          return;
        }
        
        // 一次性查询所有关联数据
        const relatedRecords = await targetDb.select(relation.target, [])
          .where({ [relation.foreignKey]: { $in: localValues } } as any);
        
        // 按外键分组
        const grouped = new Map<any, any[]>();
        for (const related of relatedRecords) {
          const fkValue = (related as any)[relation.foreignKey];
          if (!grouped.has(fkValue)) {
            grouped.set(fkValue, []);
          }
          grouped.get(fkValue)!.push(related);
        }
        
        // 分配给每条记录
        for (const record of records) {
          const localValue = record[localKey];
          const related = grouped.get(localValue) || [];
          record[relationName] = relation.type === 'hasMany' ? related : (related[0] || null);
        }
        break;
      }
      
      case 'belongsTo': {
        // 收集所有外键值
        const foreignValues = records
          .map(r => r[relation.foreignKey])
          .filter(v => v != null);
        
        if (foreignValues.length === 0) {
          records.forEach(r => r[relationName] = null);
          return;
        }
        
        // 一次性查询所有关联数据
        const targetKey = relation.targetKey || 'id';
        const relatedRecords = await targetDb.select(relation.target, [])
          .where({ [targetKey]: { $in: foreignValues } } as any);
        
        // 按主键索引
        const indexed = new Map<any, any>();
        for (const related of relatedRecords) {
          indexed.set((related as any)[targetKey], related);
        }
        
        // 分配给每条记录
        for (const record of records) {
          const fkValue = record[relation.foreignKey];
          record[relationName] = indexed.get(fkValue) || null;
        }
        break;
      }
      
      case 'belongsToMany': {
        if (!relation.pivot) {
          throw new Error('belongsToMany relation requires pivot configuration');
        }
        
        const localKey = relation.localKey || 'id';
        const targetKey = relation.targetKey || 'id';
        const { table: pivotTable, foreignPivotKey, relatedPivotKey, pivotFields } = relation.pivot;
        
        // 收集所有本地主键值
        const localValues = records.map(r => r[localKey]).filter(v => v != null);
        
        if (localValues.length === 0) {
          records.forEach(r => r[relationName] = []);
          return;
        }
        
        // 批量查询中间表
        const placeholders = localValues.map(() => '?').join(', ');
        const pivotRecords = await targetDb.query<any[]>(
          `SELECT * FROM "${pivotTable}" WHERE "${foreignPivotKey}" IN (${placeholders})`,
          localValues
        );
        
        if (pivotRecords.length === 0) {
          records.forEach(r => r[relationName] = []);
          return;
        }
        
        // 获取所有相关的目标ID
        const allRelatedIds = [...new Set(pivotRecords.map(p => p[relatedPivotKey]))];
        
        // 批量查询目标表
        const relatedRecords = await targetDb.select(relation.target, [])
          .where({ [targetKey]: { $in: allRelatedIds } } as any);
        
        // 建立目标记录索引
        const relatedIndex = new Map<any, any>();
        for (const related of relatedRecords) {
          relatedIndex.set((related as any)[targetKey], related);
        }
        
        // 按源ID分组中间表记录
        const pivotGrouped = new Map<any, any[]>();
        for (const pivot of pivotRecords) {
          const srcId = pivot[foreignPivotKey];
          if (!pivotGrouped.has(srcId)) {
            pivotGrouped.set(srcId, []);
          }
          pivotGrouped.get(srcId)!.push(pivot);
        }
        
        // 分配给每条记录
        for (const record of records) {
          const localValue = record[localKey];
          const pivots = pivotGrouped.get(localValue) || [];
          
          record[relationName] = pivots.map(pivot => {
            const related = relatedIndex.get(pivot[relatedPivotKey]);
            if (!related) return null;
            
            // 如果需要包含 pivot 数据
            if (pivotFields && pivotFields.length > 0) {
              const pivotData: Record<string, any> = {};
              pivotFields.forEach(field => {
                pivotData[field] = pivot[field];
              });
              return { ...related, pivot: pivotData };
            }
            
            return related;
          }).filter(Boolean);
        }
        break;
      }
    }
  }

  // ============================================================================
  // 带钩子的 CRUD 便捷方法
  // ============================================================================
  
  /**
   * 创建数据（支持生命周期钩子）
   * @example
   * ```ts
   * userModel.addHook('beforeCreate', (ctx) => {
   *   ctx.data.slug = slugify(ctx.data.name);
   * });
   * const user = await userModel.create({ name: 'John' });
   * ```
   */
  async create(data: Partial<S[T]>): Promise<S[T] | null> {
    if (!this.validateData(data)) {
      throw new Error('Invalid data provided');
    }
    
    // 复制数据以避免修改原始对象
    const inputData = { ...data };
    
    // beforeCreate 钩子
    const ctx = this.createHookContext({ data: inputData });
    const shouldContinue = await this.runHooks('beforeCreate', ctx);
    if (!shouldContinue) {
      return null; // 钩子取消了操作
    }
    
    try {
      // 获取 insert 方法添加的时间戳
      const insertData = { ...ctx.data } as S[T];
      await this.insert(insertData);
      
      // 返回插入的数据（包括时间戳）
      // 注意：SQLite INSERT 不返回实际数据，所以我们返回传入的数据
      const result = insertData;
      
      // afterCreate 钩子
      ctx.result = result;
      await this.runHooks('afterCreate', ctx);
      
      return ctx.result as S[T];
    } catch (error) {
      this.handleError(error as Error, 'create');
    }
  }

  /**
   * 批量创建数据（每条数据都会触发钩子）
   */
  async createMany(data: Partial<S[T]>[]): Promise<S[T][]> {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid data array provided');
    }

    try {
      const results: S[T][] = [];
      for (const item of data) {
        const result = await this.create(item);
        if (result) {
          results.push(result);
        }
      }
      return results;
    } catch (error) {
      this.handleError(error as Error, 'createMany');
    }
  }
  
  /**
   * 查找单个数据（支持生命周期钩子）
   * @example
   * ```ts
   * userModel.addHook('afterFind', (ctx) => {
   *   if (ctx.result) {
   *     ctx.result.fullName = ctx.result.firstName + ' ' + ctx.result.lastName;
   *   }
   * });
   * const user = await userModel.findOne({ id: 1 });
   * ```
   */
  async findOne(query?: Condition<S[T]>): Promise<S[T] | null> {
    // beforeFind 钩子
    const ctx = this.createHookContext({ where: query });
    const shouldContinue = await this.runHooks('beforeFind', ctx);
    if (!shouldContinue) {
      return null;
    }
    
    try {
      const selection = this.select();
      if (ctx.where) {
        selection.where(ctx.where);
      }
      const results = await selection.limit(1);
      const result = results.length > 0 ? results[0] as S[T] : null;
      
      // afterFind 钩子
      ctx.result = result ?? undefined;
      await this.runHooks('afterFind', ctx);
      
      return (ctx.result as S[T]) ?? null;
    } catch (error) {
      this.handleError(error as Error, 'findOne');
    }
  }
  
  /**
   * 查找多条数据（支持生命周期钩子）
   */
  async findAll(query?: Condition<S[T]>): Promise<S[T][]> {
    // beforeFind 钩子
    const ctx = this.createHookContext({ where: query });
    const shouldContinue = await this.runHooks('beforeFind', ctx);
    if (!shouldContinue) {
      return [];
    }
    
    try {
      const selection = this.select();
      if (ctx.where) {
        selection.where(ctx.where);
      }
      const results = await selection;
      
      // afterFind 钩子
      ctx.result = results as S[T][];
      await this.runHooks('afterFind', ctx);
      
      return (ctx.result as S[T][]) ?? [];
    } catch (error) {
      this.handleError(error as Error, 'findAll');
    }
  }
  
  /**
   * selectOne 的别名（向后兼容）
   */
  async selectOne(query?: Condition<S[T]>): Promise<S[T] | null> {
    return this.findOne(query);
  }

  /**
   * 根据ID查找
   */
  async selectById(id: any): Promise<S[T] | null> {
    return this.findOne({ id } as Condition<S[T]>);
  }
  
  /**
   * findById 别名
   */
  async findById(id: any): Promise<S[T] | null> {
    return this.findOne({ id } as Condition<S[T]>);
  }

  /**
   * 更新数据（支持生命周期钩子）
   * @example
   * ```ts
   * userModel.addHook('beforeUpdate', (ctx) => {
   *   ctx.data.updatedAt = new Date();
   * });
   * await userModel.updateWhere({ role: 'guest' }, { role: 'member' });
   * ```
   */
  async updateWhere(query: Condition<S[T]>, data: Partial<S[T]>): Promise<number> {
    // beforeUpdate 钩子
    const ctx = this.createHookContext({ where: query, data });
    const shouldContinue = await this.runHooks('beforeUpdate', ctx);
    if (!shouldContinue) {
      return 0;
    }
    
    try {
      const result = await this.update(ctx.data as Partial<S[T]>).where(ctx.where as Condition<S[T]>);
      
      // afterUpdate 钩子
      ctx.result = result;
      await this.runHooks('afterUpdate', ctx);
      
      return result;
    } catch (error) {
      this.handleError(error as Error, 'updateWhere');
    }
  }
  
  /**
   * 更新单个数据（向后兼容）
   */
  async updateOne(query: Condition<S[T]>, data: Partial<S[T]>): Promise<boolean> {
    const result = await this.updateWhere(query, data);
    return result > 0;
  }

  /**
   * 根据ID更新
   */
  async updateById(id: any, data: Partial<S[T]>): Promise<boolean> {
    return this.updateOne({ id } as Condition<S[T]>, data);
  }

  /**
   * 删除数据（支持生命周期钩子和软删除）
   * @example
   * ```ts
   * userModel.addHook('beforeDelete', async (ctx) => {
   *   // 删除前检查
   *   const user = await userModel.findOne(ctx.where);
   *   if (user?.role === 'admin') return false; // 取消删除
   * });
   * await userModel.deleteWhere({ status: 'inactive' });
   * ```
   */
  async deleteWhere(query: Condition<S[T]>): Promise<number | S[T][]> {
    // beforeDelete 钩子
    const ctx = this.createHookContext({ where: query });
    const shouldContinue = await this.runHooks('beforeDelete', ctx);
    if (!shouldContinue) {
      return this.isSoftDelete ? 0 : [];
    }
    
    try {
      const result = await this.delete(ctx.where as Condition<S[T]>);
      
      // afterDelete 钩子
      ctx.result = result;
      await this.runHooks('afterDelete', ctx);
      
      return result;
    } catch (error) {
      this.handleError(error as Error, 'deleteWhere');
    }
  }

  /**
   * 根据ID删除（支持软删除和钩子）
   */
  async deleteById(id: any): Promise<boolean> {
    const result = await this.deleteWhere({ id } as Condition<S[T]>);
    if (typeof result === 'number') {
      return result > 0;
    }
    return (result as S[T][]).length > 0;
  }
  
  /**
   * 根据ID强制删除（物理删除，忽略软删除设置，但仍触发钩子）
   */
  async forceDeleteById(id: any): Promise<boolean> {
    const query = { id } as Condition<S[T]>;
    
    // beforeDelete 钩子
    const ctx = this.createHookContext({ where: query });
    const shouldContinue = await this.runHooks('beforeDelete', ctx);
    if (!shouldContinue) {
      return false;
    }
    
    const result = await this.forceDelete(ctx.where as Condition<S[T]>);
    
    // afterDelete 钩子
    ctx.result = result;
    await this.runHooks('afterDelete', ctx);
    
    return (result as S[T][]).length > 0;
  }
  
  /**
   * 根据ID恢复软删除的记录
   */
  async restoreById(id: any): Promise<boolean> {
    const result = await this.restore({ id } as Condition<S[T]>);
    return result > 0;
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
