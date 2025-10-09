import { describe, it, expect } from 'vitest';
import type {
    Logger,
    Context,
    PluginVersion,
    DependencyOptions,
    HMROptions,
    DependencyResolution,
    PluginEventMap,
    HmrOptions
} from '../src/types';
import { Dependency } from '../src/dependency';
import { TestLogger } from '../src/test-utils';

describe('Types', () => {
    describe('Logger', () => {
        it('应该实现所有必需的日志方法', () => {
            const logger: Logger = new TestLogger();
            expect(typeof logger.debug).toBe('function');
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.error).toBe('function');
        });
    });

    describe('Context', () => {
        it('应该包含所有必需的属性', () => {
            const context: Context = {
                name: 'test-context',
                value: 'test-value',
                mounted: (parent: Dependency) => 'mounted-value',
                dispose: (value: any) => {}
            };

            expect(context.name).toBe('test-context');
            expect(context.value).toBe('test-value');
            expect(typeof context.mounted).toBe('function');
            expect(typeof context.dispose).toBe('function');
        });

        it('应该允许可选属性', () => {
            const context: Context = {
                name: 'test-context'
            };

            expect(context.name).toBe('test-context');
            expect(context.value).toBeUndefined();
            expect(context.mounted).toBeUndefined();
            expect(context.dispose).toBeUndefined();
        });
    });

    describe('PluginVersion', () => {
        it('应该包含所有必需的属性', () => {
            const version: PluginVersion = {
                name: 'test-plugin',
                version: '1.0.0',
                dependencies: {
                    'dep1': '^1.0.0'
                },
                peerDependencies: {
                    'peer1': '^2.0.0'
                }
            };

            expect(version.name).toBe('test-plugin');
            expect(version.version).toBe('1.0.0');
            expect(version.dependencies).toBeDefined();
            expect(version.peerDependencies).toBeDefined();
        });

        it('应该允许可选的依赖属性', () => {
            const version: PluginVersion = {
                name: 'test-plugin',
                version: '1.0.0'
            };

            expect(version.dependencies).toBeUndefined();
            expect(version.peerDependencies).toBeUndefined();
        });
    });

    describe('DependencyOptions', () => {
        it('应该包含所有可选属性', () => {
            const options: DependencyOptions = {
                enabled: true,
                version: '1.0.0',
                priority: 1
            };

            expect(typeof options.enabled).toBe('boolean');
            expect(typeof options.version).toBe('string');
            expect(typeof options.priority).toBe('number');
        });

        it('应该允许空对象', () => {
            const options: DependencyOptions = {};
            expect(options.enabled).toBeUndefined();
            expect(options.version).toBeUndefined();
            expect(options.priority).toBeUndefined();
        });
    });

    describe('HMROptions', () => {
        it('应该继承DependencyOptions并包含额外属性', () => {
            const options: HMROptions = {
                enabled: true,
                version: '1.0.0',
                priority: 1,
                extensions: new Set(['.ts']),
                dirs: ['/test'],
                max_listeners: 10,
                debounce: 100,
                algorithm: 'md5',
                debug: true,
                logger: new TestLogger()
            };

            expect(options.enabled).toBe(true);
            expect(options.version).toBe('1.0.0');
            expect(options.priority).toBe(1);
            expect(options.extensions).toBeInstanceOf(Set);
            expect(options.dirs).toBeInstanceOf(Array);
            expect(typeof options.max_listeners).toBe('number');
            expect(typeof options.debounce).toBe('number');
            expect(typeof options.algorithm).toBe('string');
            expect(typeof options.debug).toBe('boolean');
            expect(options.logger).toBeInstanceOf(TestLogger);
        });

        it('应该允许部分属性', () => {
            const options: HMROptions = {
                extensions: new Set(['.ts']),
                dirs: ['/test']
            };

            expect(options.extensions).toBeDefined();
            expect(options.dirs).toBeDefined();
            expect(options.enabled).toBeUndefined();
            expect(options.version).toBeUndefined();
            expect(options.priority).toBeUndefined();
        });
    });

    describe('DependencyResolution', () => {
        it('应该包含resolved和conflicts属性', () => {
            const resolution: DependencyResolution = {
                resolved: new Map([
                    ['plugin1', { name: 'plugin1', version: '1.0.0' }]
                ]),
                conflicts: [
                    { name: 'plugin2', required: '^2.0.0', found: '1.0.0' }
                ]
            };

            expect(resolution.resolved).toBeInstanceOf(Map);
            expect(resolution.conflicts).toBeInstanceOf(Array);
            expect(resolution.conflicts[0]).toEqual({
                name: 'plugin2',
                required: '^2.0.0',
                found: '1.0.0'
            });
        });
    });

    describe('PluginEventMap', () => {
        it('应该包含所有预定义的事件类型', () => {
            const eventMap: PluginEventMap = {
                'add': [new Dependency(null, 'test', 'test.ts')],
                'remove': [new Dependency(null, 'test', 'test.ts')],
                'change': [new Dependency(null, 'test', 'test.ts')],
                'error': [new Dependency(null, 'test', 'test.ts'), new Error('test')],
                'dispose': [],
                'config-changed': ['test', 'value']
            };

            expect(Array.isArray(eventMap.add)).toBe(true);
            expect(Array.isArray(eventMap.remove)).toBe(true);
            expect(Array.isArray(eventMap.change)).toBe(true);
            expect(Array.isArray(eventMap.error)).toBe(true);
            expect(Array.isArray(eventMap.dispose)).toBe(true);
            expect(Array.isArray(eventMap['config-changed'])).toBe(true);
        });

        it('应该允许自定义事件类型', () => {
            const eventMap: PluginEventMap = {
                'custom-event': ['test']
            };

            expect(Array.isArray(eventMap['custom-event'])).toBe(true);
        });
    });

    describe('HmrOptions', () => {
        it('应该包含所有可选属性', () => {
            const options: HmrOptions = {
                logger: new TestLogger(),
                watchDirs: ['/test'],
                watchExtensions: ['.ts'],
                hashAlgorithm: 'md5',
                debounceDelay: 100,
                maxListeners: 10,
                debug: true
            };

            expect(options.logger).toBeInstanceOf(TestLogger);
            expect(Array.isArray(options.watchDirs)).toBe(true);
            expect(Array.isArray(options.watchExtensions)).toBe(true);
            expect(typeof options.hashAlgorithm).toBe('string');
            expect(typeof options.debounceDelay).toBe('number');
            expect(typeof options.maxListeners).toBe('number');
            expect(typeof options.debug).toBe('boolean');
        });

        it('应该允许部分属性', () => {
            const options: HmrOptions = {
                watchDirs: ['/test'],
                debug: true
            };

            expect(Array.isArray(options.watchDirs)).toBe(true);
            expect(options.debug).toBe(true);
            expect(options.logger).toBeUndefined();
            expect(options.watchExtensions).toBeUndefined();
            expect(options.hashAlgorithm).toBeUndefined();
            expect(options.debounceDelay).toBeUndefined();
            expect(options.maxListeners).toBeUndefined();
        });
    });
});
