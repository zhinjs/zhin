import { describe, expect, it } from 'vitest';
import { Schema } from '../src/index.js';

describe('Schema fixes', () => {
  describe('falsy defaults', () => {
    it('default(0) 不应被吞', () => {
      const schema = Schema.number().default(0);
      expect(schema(undefined)).toBe(0);
    });

    it('default(false) 不应被吞', () => {
      const schema = Schema.boolean().default(false);
      expect(schema(undefined)).toBe(false);
    });

    it("default('') 不应被吞", () => {
      const schema = Schema.string().default('');
      expect(schema(undefined)).toBe('');
    });

    it('const(false) 省略值不应抛错', () => {
      const schema = Schema.const(false);
      expect(schema(undefined)).toBe(false);
    });

    it('const(0) 省略值不应抛错', () => {
      const schema = Schema.const(0);
      expect(schema(undefined)).toBe(0);
    });
  });

  describe('optional date', () => {
    it('可选 date 缺省应返回 undefined 而非 Invalid Date', () => {
      const schema = Schema.date();
      expect(schema(undefined)).toBeUndefined();
    });

    it('date 传入时间戳仍正常转换', () => {
      const schema = Schema.date();
      const result = schema(1700000000000);
      expect(result).toBeInstanceOf(Date);
      expect(result!.getTime()).toBe(1700000000000);
    });
  });

  describe('tuple length', () => {
    it('tuple 超长应抛长度不匹配错误而非 TypeError 崩溃', () => {
      const schema = Schema.tuple([Schema.string(), Schema.number()]);
      expect(() => schema(['a', 1, 'extra'] as any)).toThrow(/tuple length mismatch/);
    });

    it('tuple 长度正确仍正常工作', () => {
      const schema = Schema.tuple([Schema.string(), Schema.number()]);
      expect(schema(['a', 1])).toEqual(['a', 1]);
    });
  });

  describe('union error details', () => {
    it('union 全部分支失败时应携带分支错误信息', () => {
      const schema = Schema.union([Schema.const('a'), Schema.const('b')]);
      let caught: any;
      try {
        schema('c' as any);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toContain('union type not match');
      expect(caught.lastError).toBeDefined();
    });
  });

  describe('safeParse date/regexp validation', () => {
    it('safeParse 应拒绝非 Date|number 的 date', () => {
      const schema = Schema.date();
      expect(schema.safeParse(1700000000000).success).toBe(true);
      expect(schema.safeParse(new Date()).success).toBe(true);
      expect(schema.safeParse('not-a-date').success).toBe(false);
      expect(schema.safeParse(new Date(NaN)).success).toBe(false);
    });

    it('safeParse 应拒绝非 RegExp|string 的 regexp', () => {
      const schema = Schema.regexp();
      expect(schema.safeParse('^a+$').success).toBe(true);
      expect(schema.safeParse(/x/).success).toBe(true);
      expect(schema.safeParse(123).success).toBe(false);
    });
  });
});
