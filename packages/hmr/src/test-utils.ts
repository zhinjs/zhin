import { EventEmitter } from 'events';
import { Logger } from './types.js';
import { Dependency } from './dependency.js';
import { HMR } from './hmr.js';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 测试用日志记录器
 */
export class TestLogger implements Logger {
    logs: Array<{ level: string; args: any[] }> = [];

    debug(...args: any[]): void {
        this.logs.push({ level: 'debug', args });
    }

    info(...args: any[]): void {
        this.logs.push({ level: 'info', args });
    }

    warn(...args: any[]): void {
        this.logs.push({ level: 'warn', args });
    }

    error(...args: any[]): void {
        this.logs.push({ level: 'error', args });
    }

    clear(): void {
        this.logs = [];
    }

    getLogs(level?: string): Array<{ level: string; args: any[] }> {
        return level ? this.logs.filter(log => log.level === level) : this.logs;
    }
}

/**
 * 测试用依赖类
 */
export class TestDependency extends Dependency {
    constructor(parent: Dependency | null, name: string, filename: string) {
        super(parent, name, filename);
    }
}

/**
 * 测试用HMR类
 */
export class TestHMR extends HMR {
    createDependency(name: string, filePath: string): TestDependency {
        return new TestDependency(this, name, filePath);
    }
}

/**
 * 创建测试用临时文件
 */
export function createTempFile(content: string, ext: string = '.ts'): string {
    const tempDir = path.join(process.cwd(), 'test-workspace');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const filePath = path.join(tempDir, `test-${Date.now()}${ext}`);
    fs.writeFileSync(filePath, content);
    return filePath;
}

/**
 * 删除测试用临时文件
 */
export function removeTempFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

/**
 * 清理测试工作目录
 */
export function cleanupTestWorkspace(): void {
    const tempDir = path.join(process.cwd(), 'test-workspace');
    if (fs.existsSync(tempDir)) {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore errors during cleanup
        }
    }
}

/**
 * 等待指定时间
 */
export function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 等待事件触发
 */
export function waitForEvent(emitter: EventEmitter, event: string, timeout: number = 1000): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout waiting for event: ${event}`));
        }, timeout);

        emitter.once(event, (...args) => {
            clearTimeout(timer);
            resolve(args);
        });
    });
}

/**
 * 创建测试用HMR实例
 */
export function createTestHMR(options: { name?: string; logger?: Logger } = {}): TestHMR {
    const logger = options.logger || new TestLogger();
    return new TestHMR(options.name || 'test-hmr', { logger });
}

/**
 * 创建测试用依赖实例
 */
export function createTestDependency(options: {
    parent?: Dependency | null;
    name?: string;
    filename?: string;
} = {}): TestDependency {
    return new TestDependency(
        options.parent || null,
        options.name || 'test-dependency',
        options.filename || '/test/path'
    );
}

/**
 * 创建测试用文件内容
 */
export function createTestFileContent(options: {
    exportName?: string;
    dependencies?: string[];
    contexts?: string[];
    events?: string[];
} = {}): string {
    const {
        exportName = 'TestModule',
        dependencies = [],
        contexts = [],
        events = []
    } = options;

    const dependencyImports = dependencies
        .map((dep, i) => `import { Dependency${i} } from '${dep}';`)
        .join('\n');

    const contextRegistrations = contexts
        .map(ctx => `
    this.register({
        name: '${ctx}',
        mounted: () => '${ctx}-value',
        dispose: () => {}
    });`)
        .join('\n');

    const eventHandlers = events
        .map(evt => `
    this.on('${evt}', () => {
        // Handle ${evt} event
    });`)
        .join('\n');

    return `
import { Dependency } from '@zhin.js/hmr';
${dependencyImports}

export class ${exportName} extends Dependency {
    constructor(parent, name, filename) {
        super(parent, name, filename);
        ${contextRegistrations}
        ${eventHandlers}
    }
}
`;
}

/**
 * 创建测试用目录结构
 */
export function createTestDirectory(structure: Record<string, string | null>): string {
    const tempDir = path.join(process.cwd(), 'test-workspace', `test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    for (const [filePath, content] of Object.entries(structure)) {
        const fullPath = path.join(tempDir, filePath);
        const dir = path.dirname(fullPath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (content === null) {
            fs.mkdirSync(fullPath, { recursive: true });
        } else {
            fs.writeFileSync(fullPath, content);
        }
    }

    return tempDir;
}

/**
 * 创建测试用模块文件
 */
export function createTestModule(options: {
    name?: string;
    content?: string;
    ext?: string;
} = {}): { filePath: string; cleanup: () => void } {
    const {
        name = 'test-module',
        content = 'export default class TestModule {}',
        ext = '.ts'
    } = options;

    const filePath = createTempFile(content, ext);
    return {
        filePath,
        cleanup: () => removeTempFile(filePath)
    };
}

/**
 * 模拟文件变更
 */
export function simulateFileChange(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content);
}

/**
 * 创建测试用上下文
 */
export function createTestContext(name: string, value?: any): {
    name: string;
    value?: any;
    mounted?: (parent: any) => any;
    dispose?: (value: any) => void;
} {
    return {
        name,
        value,
        mounted: parent => value || `${name}-value`,
        dispose: () => {}
    };
}

/**
 * 创建测试用事件监听器
 */
export function createTestEventListener(): {
    handler: (...args: any[]) => void;
    events: Array<{ args: any[] }>;
} {
    const events: Array<{ args: any[] }> = [];
    const handler = (...args: any[]) => {
        events.push({ args });
    };
    return { handler, events };
}
