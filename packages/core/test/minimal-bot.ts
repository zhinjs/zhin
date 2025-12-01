import { App } from '../src/app';
import { LogLevel } from '@zhin.js/logger';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMinimalBot() {
    const app = new App({
        log_level: LogLevel.INFO,
        plugin_dirs: [path.join(__dirname, 'plugins')],
        plugins: [],
        bots: [],
        debug: true
    });

    console.log('Starting Minimal Bot...');
    await app.start();
    console.log('Minimal Bot Started');

    // Simulate a message
    // await app.receiveMessage(...)
    
    await app.stop();
}

if (process.argv[1] === __filename) {
    runMinimalBot().catch(console.error);
}

