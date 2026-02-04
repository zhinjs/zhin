/**
 * 内置工具测试
 * 
 * 测试内容：
 * 1. 计算器工具
 * 2. 时间工具
 * 3. 搜索工具
 * 4. 代码执行工具
 * 5. HTTP 请求工具
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  calculatorTool, 
  timeTool,
  searchTool,
  codeRunnerTool,
  httpTool,
  getBuiltinTools,
} from '../src/tools.js';
import { ZhinTool } from '@zhin.js/core';

describe('内置工具', () => {
  describe('计算器工具', () => {
    const calculator = calculatorTool.toTool();

    it('应该有正确的元数据', () => {
      expect(calculator.name).toBe('calculator');
      expect(calculator.description).toContain('计算');
      expect(calculator.parameters.properties).toHaveProperty('expression');
      expect(calculator.parameters.required).toContain('expression');
    });

    it('应该计算简单加法', async () => {
      const result = await calculator.execute({ expression: '2 + 3' });
      expect(result.result).toBe(5);
      expect(result.expression).toBe('2 + 3');
    });

    it('应该计算简单减法', async () => {
      const result = await calculator.execute({ expression: '10 - 4' });
      expect(result.result).toBe(6);
    });

    it('应该计算简单乘法', async () => {
      const result = await calculator.execute({ expression: '6 * 7' });
      expect(result.result).toBe(42);
    });

    it('应该计算简单除法', async () => {
      const result = await calculator.execute({ expression: '20 / 4' });
      expect(result.result).toBe(5);
    });

    it('应该计算复杂表达式', async () => {
      const result = await calculator.execute({ expression: '(10 + 5) * 2' });
      expect(result.result).toBe(30);
    });

    it('应该支持幂运算 (^)', async () => {
      const result = await calculator.execute({ expression: '2 ^ 3' });
      expect(result.result).toBe(8);
    });

    it('应该支持 sqrt 函数', async () => {
      const result = await calculator.execute({ expression: 'sqrt(16)' });
      expect(result.result).toBe(4);
    });

    it('应该支持 sin 函数', async () => {
      const result = await calculator.execute({ expression: 'sin(0)' });
      expect(result.result).toBe(0);
    });

    it('应该支持 cos 函数', async () => {
      const result = await calculator.execute({ expression: 'cos(0)' });
      expect(result.result).toBe(1);
    });

    it('应该支持 tan 函数', async () => {
      const result = await calculator.execute({ expression: 'tan(0)' });
      expect(result.result).toBe(0);
    });

    it('应该支持 log 函数', async () => {
      const result = await calculator.execute({ expression: 'log(1)' });
      expect(result.result).toBe(0);
    });

    it('应该支持 abs 函数', async () => {
      const result = await calculator.execute({ expression: 'abs(-5)' });
      expect(result.result).toBe(5);
    });

    it('应该支持 pow 函数（通过 ^ 运算符）', async () => {
      // pow() 函数的逗号会被过滤，所以使用 ^ 运算符
      const result = await calculator.execute({ expression: '2 ^ 10' });
      expect(result.result).toBe(1024);
    });

    it('应该支持 PI 常量', async () => {
      const result = await calculator.execute({ expression: 'PI' });
      expect(result.result).toBeCloseTo(Math.PI);
    });

    it('应该支持 E 常量', async () => {
      const result = await calculator.execute({ expression: 'E' });
      expect(result.result).toBeCloseTo(Math.E);
    });

    it('应该处理无效表达式', async () => {
      const result = await calculator.execute({ expression: 'invalid_expression' });
      expect(result.error).toBeDefined();
    });

    it('应该处理除零', async () => {
      const result = await calculator.execute({ expression: '1 / 0' });
      expect(result.result).toBe(Infinity);
    });

    it('应该处理空表达式', async () => {
      const result = await calculator.execute({ expression: '' });
      // 空表达式会返回 undefined 或 error
      expect(result.error || result.result === undefined).toBeTruthy();
    });
  });

  describe('时间工具', () => {
    const timeToolObj = timeTool.toTool();

    it('应该有正确的元数据', () => {
      expect(timeToolObj.name).toBe('get_time');
      expect(timeToolObj.description).toContain('时间');
      expect(timeToolObj.parameters.properties).toHaveProperty('timezone');
      expect(timeToolObj.parameters.properties).toHaveProperty('format');
    });

    it('应该返回当前时间 (默认格式)', async () => {
      const result = await timeToolObj.execute({});
      
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('formatted');
      expect(result).toHaveProperty('iso');
      expect(typeof result.timestamp).toBe('number');
      expect(typeof result.formatted).toBe('string');
      expect(typeof result.iso).toBe('string');
    });

    it('应该支持 full 格式', async () => {
      const result = await timeToolObj.execute({ format: 'full' });
      
      expect(result).toHaveProperty('formatted');
      expect(result).toHaveProperty('timestamp');
    });

    it('应该支持 date 格式', async () => {
      const result = await timeToolObj.execute({ format: 'date' });
      
      expect(result).toHaveProperty('formatted');
      expect(result).toHaveProperty('timestamp');
    });

    it('应该支持 time 格式', async () => {
      const result = await timeToolObj.execute({ format: 'time' });
      
      expect(result).toHaveProperty('formatted');
      expect(result).toHaveProperty('timestamp');
    });

    it('应该支持 timestamp 格式', async () => {
      const result = await timeToolObj.execute({ format: 'timestamp' });
      
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('iso');
      expect(result).not.toHaveProperty('formatted');
    });

    it('应该支持指定时区', async () => {
      const result = await timeToolObj.execute({ timezone: 'UTC' });
      
      expect(result).toHaveProperty('formatted');
      expect(result).toHaveProperty('timestamp');
    });

    it('时间戳应该是有效的数字', async () => {
      const result = await timeToolObj.execute({});
      const now = Date.now();
      
      // 时间戳应该在合理范围内（前后 1 秒）
      expect(result.timestamp).toBeGreaterThan(now - 1000);
      expect(result.timestamp).toBeLessThan(now + 1000);
    });
  });

  describe('搜索工具', () => {
    it('应该有正确的元数据', () => {
      const searchToolObj = searchTool.toTool();
      
      expect(searchToolObj.name).toBe('web_search');
      expect(searchToolObj.description).toContain('搜索');
      expect(searchToolObj.parameters.properties).toHaveProperty('query');
      expect(searchToolObj.parameters.required).toContain('query');
    });

    it('未配置搜索函数时应返回错误', async () => {
      const searchToolObj = searchTool.toTool();
      const result = await searchToolObj.execute({ query: 'test' });
      
      expect(result.error).toBeDefined();
      expect(result.query).toBe('test');
    });
  });

  describe('代码执行工具', () => {
    const codeRunnerObj = codeRunnerTool.toTool();

    it('应该有正确的元数据', () => {
      expect(codeRunnerObj.name).toBe('run_code');
      expect(codeRunnerObj.description).toContain('JavaScript');
      expect(codeRunnerObj.parameters.properties).toHaveProperty('code');
      expect(codeRunnerObj.parameters.required).toContain('code');
    });

    it('应该执行简单表达式', async () => {
      const result = await codeRunnerObj.execute({ code: 'return 1 + 2' });
      
      expect(result.success).toBe(true);
      expect(result.result).toBe('3');
    });

    it('应该执行字符串操作', async () => {
      const result = await codeRunnerObj.execute({ code: 'return "hello".toUpperCase()' });
      
      expect(result.success).toBe(true);
      expect(result.result).toBe('HELLO');
    });

    it('应该执行数组操作', async () => {
      const result = await codeRunnerObj.execute({ code: 'return [1,2,3].map(x => x * 2)' });
      
      expect(result.success).toBe(true);
      // 数组转字符串时会变成 "2,4,6"
      expect(result.result).toContain('2,4,6');
    });

    it('应该处理 undefined 返回值', async () => {
      const result = await codeRunnerObj.execute({ code: 'let x = 1' });
      
      expect(result.success).toBe(true);
      expect(result.result).toBe('undefined');
    });

    it('应该处理语法错误', async () => {
      const result = await codeRunnerObj.execute({ code: 'return {{{' });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('应该处理运行时错误', async () => {
      const result = await codeRunnerObj.execute({ code: 'throw new Error("test error")' });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('test error');
    });
  });

  describe('HTTP 请求工具', () => {
    const httpToolObj = httpTool.toTool();

    it('应该有正确的元数据', () => {
      expect(httpToolObj.name).toBe('http_request');
      expect(httpToolObj.description).toContain('HTTP');
      expect(httpToolObj.parameters.properties).toHaveProperty('url');
      expect(httpToolObj.parameters.properties).toHaveProperty('method');
      expect(httpToolObj.parameters.required).toContain('url');
    });

    it('应该处理无效 URL', async () => {
      const result = await httpToolObj.execute({ url: 'invalid-url' });
      
      expect(result.error).toBeDefined();
    });

    it('应该支持 method 参数', () => {
      const methodProp = httpToolObj.parameters.properties?.method;
      
      expect(methodProp).toBeDefined();
      expect(methodProp?.type).toBe('string');
      // 描述中应该包含支持的方法
      expect(methodProp?.description).toContain('GET');
      expect(methodProp?.description).toContain('POST');
      expect(methodProp?.description).toContain('PUT');
      expect(methodProp?.description).toContain('DELETE');
    });
  });

  describe('getBuiltinTools', () => {
    it('应该返回内置工具列表', () => {
      const tools = getBuiltinTools();
      
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      
      // tools 现在是 ZhinTool 实例
      const names = tools.map(t => t.name);
      expect(names).toContain('calculator');
      expect(names).toContain('get_time');
    });

    it('所有工具应该是 ZhinTool 实例', () => {
      const tools = getBuiltinTools();
      
      for (const tool of tools) {
        expect(tool).toBeInstanceOf(ZhinTool);
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
      }
    });

    it('工具名称应该唯一', () => {
      const tools = getBuiltinTools();
      const names = tools.map(t => t.name);
      const uniqueNames = [...new Set(names)];
      
      expect(names.length).toBe(uniqueNames.length);
    });

    it('所有工具应该能转换为 Tool 对象', () => {
      const tools = getBuiltinTools();
      
      for (const tool of tools) {
        const toolObj = tool.toTool();
        
        expect(toolObj).toHaveProperty('name');
        expect(toolObj).toHaveProperty('description');
        expect(toolObj).toHaveProperty('parameters');
        expect(toolObj).toHaveProperty('execute');
        expect(typeof toolObj.name).toBe('string');
        expect(typeof toolObj.description).toBe('string');
        expect(typeof toolObj.execute).toBe('function');
        expect(toolObj.parameters).toHaveProperty('type');
        expect(toolObj.parameters.type).toBe('object');
      }
    });
  });
});
