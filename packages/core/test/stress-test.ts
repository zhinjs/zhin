import { App } from '../src/app';
import { LogLevel } from '@zhin.js/logger';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as fs from 'fs';
// import { Message } from '../src/message'; // Message is a type/namespace, not a class

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runStressTest() {
    const PLUGIN_COUNT = 50;
    const MSG_COUNT = 10000;
    const WORK_DIR = path.join(__dirname, 'stress_plugins');

    console.log('Starting Core Stress Test');
    
    // Setup workspace
    if (fs.existsSync(WORK_DIR)) fs.rmSync(WORK_DIR, { recursive: true, force: true });
    fs.mkdirSync(WORK_DIR, { recursive: true });

    // Generate plugins
    let loadedCount = 0;
    for (let i = 0; i < PLUGIN_COUNT; i++) {
        fs.writeFileSync(path.join(WORK_DIR, `plugin-${i}.ts`), `
            import { useContext } from '${path.resolve(__dirname, '../src/plugin').replace(/\\/g, '/')}';
            
            export function install(ctx) {
                ctx.on('message.receive', (msg) => {
                    // console.log('Plugin ${i} received message');
                });
                
                ctx.middleware(async (msg, next) => {
                    await next();
                });
            }
        `);
    }

    const CONFIG_FILE = path.join(WORK_DIR, 'zhin.test.yaml');
    // Write config to file to avoid reload overriding it with defaults
    const config = {
        log_level: LogLevel.WARN,
        plugin_dirs: [WORK_DIR],
        plugins: Array.from({ length: PLUGIN_COUNT }, (_, i) => `plugin-${i}`),
        bots: [],
        debug: false
    };
    
    // Simple YAML stringify since we can't require 'yaml' easily in ESM without import
    const yamlString = `
log_level: ${config.log_level}
debug: ${config.debug}
plugin_dirs:
${config.plugin_dirs.map(d => `  - ${d}`).join('\n')}
plugins:
${config.plugins.map(p => `  - ${p}`).join('\n')}
bots: []
    `;
    
    fs.writeFileSync(CONFIG_FILE, yamlString);

    const app = new App(CONFIG_FILE);

    console.log('Starting App...');
    const startBoot = performance.now();
    await app.start();
    console.log(`App started in ${(performance.now() - startBoot).toFixed(2)}ms`);
    
    // Verify plugins loaded
    const loadedPlugins = app.hmrManager.dependencyList.length; // App itself + plugins
    console.log(`Loaded Dependencies: ${loadedPlugins}`);
    if (loadedPlugins < PLUGIN_COUNT) {
        console.warn(`WARNING: Only ${loadedPlugins} dependencies loaded (expected >= ${PLUGIN_COUNT})`);
    }

    const initialMem = process.memoryUsage();
    console.log(`Initial RSS: ${(initialMem.rss / 1024 / 1024).toFixed(2)} MB`);

    console.log(`Sending ${MSG_COUNT} messages...`);
    const startMsg = performance.now();
    
    // Mock message factory
    const createMockMsg = (id: number) => ({
        $id: `msg-${id}`,
        $adapter: 'mock',
        $bot: 'bot1',
        $content: [{ type: 'text', data: { text: 'hello' } }],
        $sender: { id: 'user1' },
        $channel: { id: 'group1', type: 'group' as const },
        $timestamp: Date.now(),
        $raw: 'hello',
        $reply: async () => 'reply-id',
        $recall: async () => {},
        // Custom fields usually added by adapters
        raw_message: 'hello',
        message_type: 'group',
        sender: { id: 'user1' },
    });

    for (let i = 0; i < MSG_COUNT; i++) {
        const msg = createMockMsg(i);
        await app.receiveMessage(msg as any);
        
        if (i % 1000 === 0) {
            const mem = process.memoryUsage();
            process.stdout.write(`\rMsgs: ${i}, RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB`);
        }
    }
    
    console.log(`\nProcessed ${MSG_COUNT} messages in ${(performance.now() - startMsg).toFixed(2)}ms`);
    console.log(`Avg: ${((performance.now() - startMsg) / MSG_COUNT).toFixed(3)}ms/msg`);

    const finalMem = process.memoryUsage();
    console.log(`Final RSS: ${(finalMem.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Memory Delta: ${((finalMem.rss - initialMem.rss) / 1024 / 1024).toFixed(2)} MB`);

    await app.stop();
    fs.rmSync(WORK_DIR, { recursive: true, force: true });
}

runStressTest().catch(console.error);

