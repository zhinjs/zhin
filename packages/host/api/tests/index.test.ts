/**
 * console 插件测试
 * 测试路径安全性、TypeScript transform 管道
 */
import { describe, it, expect, vi } from 'vitest';
import { isTransformable, clearTransformCache } from '../src/transform.js';

describe('isTransformable', () => {
  it('.ts 应需要转译', () => {
    expect(isTransformable('app.ts')).toBe(true);
  });

  it('.tsx 应需要转译', () => {
    expect(isTransformable('Component.tsx')).toBe(true);
  });

  it('.jsx 应需要转译', () => {
    expect(isTransformable('App.jsx')).toBe(true);
  });

  it('.js 不应需要转译', () => {
    expect(isTransformable('bundle.js')).toBe(false);
  });

  it('.css 不应需要转译', () => {
    expect(isTransformable('style.css')).toBe(false);
  });

  it('.json 不应需要转译', () => {
    expect(isTransformable('config.json')).toBe(false);
  });

  it('大写扩展名应正确处理', () => {
    expect(isTransformable('app.TS')).toBe(true);
    expect(isTransformable('app.TSX')).toBe(true);
  });

  it('带路径的文件应正确处理', () => {
    expect(isTransformable('/path/to/app.ts')).toBe(true);
    expect(isTransformable('./relative/Component.tsx')).toBe(true);
  });
});

describe('clearTransformCache', () => {
  it('调用不应抛错', () => {
    expect(() => clearTransformCache()).not.toThrow();
  });
});
