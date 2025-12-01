import { Dependency } from '../src/dependency';
import { HMRManager } from '../src/hmr';
import { Logger } from '../src/types';
import * as path from 'path';
import * as fs from 'fs';
import { PerformanceMonitor } from '../src/performance';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class NoOpLogger implements Logger {
    debug() {}
    info() {}
    warn() {}
    error(msg: string, ...args: any[]) { console.error(msg, ...args); }
}

class StressTestHost extends Dependency {
    public hmrManager: HMRManager<Dependency>;
    
    constructor(workDir: string) {
        super(null, 'StressTestHost', __filename);
        this.hmrManager = new HMRManager(this, {
            logger: new NoOpLogger(),
            dirs: [workDir],
            debug: false
        });
    }

    createDependency(name: string, filePath: string): Dependency {
        return new Dependency(this, name, filePath);
    }
}

async function runStressTest() {
    const PLUGIN_COUNT = 100;
    const DURATION_MS = 10000; // 10 seconds
    const workDir = path.join(__dirname, 'stress_plugins');

    console.log(`Starting HMR Stress Test`);
    console.log(`Plugins: ${PLUGIN_COUNT}`);
    console.log(`Duration: ${DURATION_MS}ms`);

    // Setup workspace
    if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });

    const host = new StressTestHost(workDir);
    const monitor = host.hmrManager.performanceMonitor;
    
    // Create initial plugins
    console.log('Creating plugins...');
    for (let i = 0; i < PLUGIN_COUNT; i++) {
        fs.writeFileSync(path.join(workDir, `plugin-${i}.js`), `
            export const id = ${i};
            export const timestamp = ${Date.now()};
        `);
    }

    // Load all plugins
    console.log('Loading plugins...');
    const startLoad = performance.now();
    for (let i = 0; i < PLUGIN_COUNT; i++) {
        await host.hmrManager.import(`plugin-${i}`, path.join(workDir, `plugin-${i}.js`));
    }
    console.log(`Loaded ${PLUGIN_COUNT} plugins in ${(performance.now() - startLoad).toFixed(2)}ms`);

    // Start stress loop
    console.log('Starting reload loop...');
    const startTime = Date.now();
    let reloadCount = 0;
    
    // Monitor initial memory
    const initialMem = process.memoryUsage();
    console.log(`Initial RSS: ${(initialMem.rss / 1024 / 1024).toFixed(2)} MB`);

    while (Date.now() - startTime < DURATION_MS) {
        // Pick random plugin to update
        const id = Math.floor(Math.random() * PLUGIN_COUNT);
        const filePath = path.join(workDir, `plugin-${id}.js`);
        
        // Update file content
        fs.writeFileSync(filePath, `
            export const id = ${id};
            export const timestamp = ${Date.now()};
            export const random = ${Math.random()};
        `);

        // Trigger reload manually (simulating file watcher event)
        await host.hmrManager.moduleLoader.reload(filePath);
        reloadCount++;

        if (reloadCount % 100 === 0) {
            const mem = process.memoryUsage();
            process.stdout.write(`\rReloads: ${reloadCount}, RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB`);
        }
        
        // Small delay to prevent starving I/O
        await new Promise(r => setTimeout(r, 10));
    }

    console.log('\n\nTest Finished.');
    console.log(`Total Reloads: ${reloadCount}`);
    
    const finalMem = process.memoryUsage();
    console.log(`Final RSS: ${(finalMem.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Memory Delta: ${((finalMem.rss - initialMem.rss) / 1024 / 1024).toFixed(2)} MB`);
    
    console.log('\nPerformance Report:');
    console.log(host.hmrManager.getPerformanceReport());

    // Cleanup
    host.hmrManager.dispose();
    fs.rmSync(workDir, { recursive: true, force: true });
}

runStressTest().catch(console.error);

