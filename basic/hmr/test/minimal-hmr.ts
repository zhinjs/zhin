import { Dependency } from '../src/dependency';
import { HMRManager } from '../src/hmr';
import { Logger } from '../src/types';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple Logger
class ConsoleLogger implements Logger {
    debug(...args: any[]) { if (process.env.DEBUG) console.debug('[DEBUG]', ...args); }
    info(...args: any[]) { console.info('[INFO]', ...args); }
    warn(...args: any[]) { console.warn('[WARN]', ...args); }
    error(...args: any[]) { console.error('[ERROR]', ...args); }
}

// Minimal Host Class
class MinimalHost extends Dependency {
    public hmrManager: HMRManager<Dependency>;

    constructor() {
        super(null, 'MinimalHost', __filename);
        this.hmrManager = new HMRManager(this, {
            logger: new ConsoleLogger(),
            dirs: [path.join(__dirname, 'plugins')],
            debug: !!process.env.DEBUG
        });
    }

    createDependency(name: string, filePath: string): Dependency {
        return new Dependency(this, name, filePath);
    }

    async start() {
        this.hmrManager.logger.info('Starting Minimal Host...');
        const pluginDir = path.join(__dirname, 'plugins');
        if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });

        // Create a sample plugin
        const pluginPath = path.join(pluginDir, 'sample-plugin.js');
        fs.writeFileSync(pluginPath, `
            export class SamplePlugin {
                constructor() {
                    console.log('Sample Plugin Loaded');
                }
            }
        `);

        await this.hmrManager.import('sample-plugin', pluginPath);
        this.hmrManager.logger.info('Minimal Host Started');
    }
}

// Execute if run directly
// if (require.main === module) {
    const host = new MinimalHost();
    host.start().catch(console.error);
// }

export { MinimalHost };

