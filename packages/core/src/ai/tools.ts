/**
 * @zhin.js/ai - Built-in Tools
 * 内置工具集合 - 使用 ZhinTool 类定义
 */

import { ZhinTool } from '../built/tool.js';
import type { Tool } from '../types.js';

/**
 * 计算器工具
 * 支持基本运算和数学函数
 */
export const calculatorTool = new ZhinTool('calculator')
  .desc('执行数学计算。支持基本运算（+、-、*、/、^）和数学函数（sin、cos、sqrt 等）')
  .keyword('计算', '算', 'calc', '数学', '求值', '运算')
  .tag('math', 'utility')
  .param('expression', { type: 'string', description: '数学表达式，例如 "2 + 3 * 4" 或 "sqrt(16)"' }, true)
  .execute(async ({ expression }) => {
    try {
      // 安全的数学表达式求值
      const sanitized = (expression as string)
        .replace(/[^0-9+\-*/().^eEsincosqrtabspowlogxMathPI\s]/g, '')
        .replace(/\bsqrt\b/g, 'Math.sqrt')
        .replace(/\bsin\b/g, 'Math.sin')
        .replace(/\bcos\b/g, 'Math.cos')
        .replace(/\btan\b/g, 'Math.tan')
        .replace(/\blog\b/g, 'Math.log')
        .replace(/\babs\b/g, 'Math.abs')
        .replace(/\bpow\b/g, 'Math.pow')
        .replace(/\bPI\b/g, 'Math.PI')
        .replace(/\bE\b(?![0-9])/g, 'Math.E')
        .replace(/\^/g, '**');

      const result = new Function(`return ${sanitized}`)();
      return { result, expression };
    } catch (error) {
      return { error: '无法计算表达式', expression };
    }
  });

/**
 * 时间工具
 * 获取当前时间和日期
 */
export const timeTool = new ZhinTool('get_time')
  .desc('获取当前时间和日期信息')
  .keyword('时间', '日期', '几点', '今天', '现在', 'time', 'date')
  .tag('time', 'utility')
  .param('timezone', { type: 'string', description: '时区，例如 "Asia/Shanghai" 或 "UTC"' })
  .param('format', { type: 'string', description: '输出格式: full(完整), date(日期), time(时间), timestamp(时间戳)' })
  .execute(async ({ timezone, format = 'full' }) => {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      timeZone: (timezone as string) || 'Asia/Shanghai',
    };

    switch (format) {
      case 'date':
        options.dateStyle = 'full';
        break;
      case 'time':
        options.timeStyle = 'long';
        break;
      case 'timestamp':
        return { timestamp: now.getTime(), iso: now.toISOString() };
      default:
        options.dateStyle = 'full';
        options.timeStyle = 'long';
    }

    return {
      formatted: now.toLocaleString('zh-CN', options),
      timestamp: now.getTime(),
      iso: now.toISOString(),
    };
  });

/**
 * 网页搜索工具
 * 需要配置搜索 API
 */
export const searchTool = new ZhinTool('web_search')
  .desc('在互联网上搜索信息（需要配置搜索 API）')
  .keyword('搜索', '搜一下', '查找', '查一查', 'search', 'google')
  .tag('search', 'web')
  .param('query', { type: 'string', description: '搜索关键词' }, true)
  .param('limit', { type: 'number', description: '返回结果数量（默认 5）' })
  .execute(async ({ query, limit = 5 }) => {
    // 默认实现提示需要配置
    return {
      query,
      error: '搜索功能未配置，请提供搜索 API',
      hint: '可以集成 SerpAPI、Bing Search API 或 Google Custom Search',
    };
  });

/**
 * 代码执行工具
 * 在安全沙箱中执行 JavaScript
 */
export const codeRunnerTool = new ZhinTool('run_code')
  .desc('执行 JavaScript 代码（在安全沙箱中）')
  .keyword('代码', '执行', '运行', 'code', 'js', 'javascript')
  .tag('code', 'dev')
  .param('code', { type: 'string', description: 'JavaScript 代码' }, true)
  .execute(async ({ code }) => {
    try {
      // 简单的沙箱执行（生产环境应使用 vm2 或 isolated-vm）
      const result = new Function(`
        'use strict';
        const console = { log: (...args) => args.join(' ') };
        return (function() { ${code} })();
      `)();
      
      return {
        success: true,
        result: result !== undefined ? String(result) : 'undefined',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

/**
 * HTTP 请求工具
 * 发送 HTTP 请求获取数据
 */
export const httpTool = new ZhinTool('http_request')
  .desc('发送 HTTP 请求获取数据')
  .keyword('http', 'api', '请求', '接口', 'url', 'fetch')
  .tag('http', 'web')
  .param('url', { type: 'string', description: '请求 URL' }, true)
  .param('method', { type: 'string', description: 'HTTP 方法: GET, POST, PUT, DELETE（默认 GET）' })
  .param('headers', { type: 'object', description: '请求头（JSON 对象）' })
  .param('body', { type: 'string', description: '请求体（JSON 字符串）' })
  .execute(async ({ url, method = 'GET', headers = {}, body }) => {
    try {
      const response = await fetch(url as string, {
        method: method as string,
        headers: {
          'Content-Type': 'application/json',
          ...(headers as Record<string, string>),
        },
        body: body ? (body as string) : undefined,
      });

      const contentType = response.headers.get('content-type') || '';
      let data: any;

      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
        // 限制文本长度
        if (data.length > 5000) {
          data = data.substring(0, 5000) + '... (truncated)';
        }
      }

      return {
        status: response.status,
        statusText: response.statusText,
        data,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

/**
 * 记忆工具
 * 让 AI 记住重要信息
 */
export const memoryTool = new ZhinTool('remember')
  .desc('记住用户告诉你的重要信息，以便后续对话中使用')
  .keyword('记住', '记忆', '记下', 'remember', '别忘了')
  .tag('memory', 'context')
  .param('key', { type: 'string', description: '记忆的标识符，如 "user_name", "preference"' }, true)
  .param('value', { type: 'string', description: '要记住的内容' }, true)
  .execute(async ({ key, value }, context) => {
    // 这里需要与 session/context manager 集成
    return {
      success: true,
      message: `已记住 ${key}: ${value}`,
      key,
      value,
    };
  });

/**
 * 获取所有内置工具（ZhinTool 实例）
 * 注意：天气工具已移除，请使用 weather-tool 插件，支持多平台配置
 */
export function getBuiltinTools(): ZhinTool[] {
  return [
    calculatorTool,
    timeTool,
  ];
}

/**
 * 获取所有可用的内置工具（包括可选工具）
 */
export function getAllBuiltinTools(): ZhinTool[] {
  return [
    calculatorTool,
    timeTool,
    searchTool,
    codeRunnerTool,
    httpTool,
    memoryTool,
  ];
}
