# JSX Hot Module Replacement (HMR) System

[English](README.md) | [中文](README.zh-CN)

A powerful and flexible Hot Module Replacement (HMR) system for Node.js applications, providing efficient module reloading and dependency management capabilities.

## Features

- 🔄 **Smart File Change Detection**
   - Dual detection mechanism using mtime and hash
   - Optimized for both small and large files
   - Configurable file extensions watching

- 🏗️ **Advanced Dependency Management**
   - Automatic dependency resolution
   - Circular dependency detection
   - Version compatibility checking
   - Plugin lifecycle management

- 🎯 **Context System**
   - React Hooks-style context management
   - Dependency injection support
   - Automatic context propagation

- 📊 **Performance Monitoring**
   - Detailed reload statistics
   - Performance metrics tracking
   - Debug mode support

- 🔧 **Flexible Configuration**
   - Customizable watch options
   - Extensible logging system
   - Configurable debounce timing

## Installation

```bash
npm install @your-org/hmr
```

## Quick Start

```typescript
import { HMR } from '@your-org/hmr';

// Create a custom HMR implementation
class MyHMR extends HMR {
  createDependency(name: string, filePath: string) {
    // Implement your dependency creation logic
    return new MyDependency(this, name, filePath);
  }
}

// Initialize HMR
const hmr = new MyHMR('my-app', __filename, {
  dirs: ['./src'],
  extensions: new Set(['.ts', '.js', '.json']),
  debug: true
});

// Start watching
hmr.on('change', (dependency) => {
  console.log(`Module changed: ${dependency.name}`);
});
```

## Configuration Options

```typescript
interface HMRConfig {
  enabled?: boolean;
  priority?: number;
  disable_dependencies?: string[];
  extensions?: Set<string>;
  dirs?: string[];
  max_listeners?: number;
  debounce?: number;
  algorithm?: string;
  debug?: boolean;
  logger?: Logger;
}
```

## API Reference

### Core Methods

- `createDependency(name: string, filePath: string): P` - Abstract method to create dependency instances
- `dispose(): void` - Clean up resources and stop watching
- `getConfig(): Readonly<HMRConfig>` - Get current configuration
- `updateHMRConfig(config: Partial<HMRConfig>): void` - Update configuration

### Directory Management

- `addWatchDir(dir: string): boolean` - Add directory to watch list
- `removeWatchDir(dir: string): boolean` - Remove directory from watch list
- `updateWatchDirs(dirs: string[]): void` - Update watch directories
- `getWatchDirs(): ReadonlyArray<string>` - Get current watch directories

### Performance Monitoring

- `getPerformanceStats()` - Get performance statistics
- `resetPerformanceStats(): void` - Reset performance metrics
- `setDebugMode(enabled: boolean): void` - Toggle debug mode

### Events

- `add` - Emitted when a new dependency is added
- `remove` - Emitted when a dependency is removed
- `change` - Emitted when a dependency changes
- `error` - Emitted when an error occurs
- `dispose` - Emitted when the HMR system is disposed
- `config-changed` - Emitted when configuration changes

## Advanced Usage

### Custom Logger

```typescript
import { Logger } from '@your-org/hmr';

class CustomLogger implements Logger {
  debug(message: string, ...args: unknown[]): void {
    // Implement debug logging
  }
  info(message: string, ...args: unknown[]): void {
    // Implement info logging
  }
  warn(message: string, ...args: unknown[]): void {
    // Implement warning logging
  }
  error(message: string, ...args: unknown[]): void {
    // Implement error logging
  }
}

const hmr = new MyHMR('my-app', __filename, {
  logger: new CustomLogger()
});
```

### Context Management

```typescript
// Create a context
hmr.createContext({
  name: 'myContext',
  mounted: (parent) => {
    // Initialize context value
    return someValue;
  },
  dispose: (value) => {
    // Clean up context value
  }
});

// Use context in dependencies
const context = dependency.useContext('myContext');
```

## Performance Considerations

- The system uses a smart file change detection mechanism that combines mtime and hash checks
- For small files (< 1MB), only mtime is used for change detection
- For large files, hash-based detection is used
- Configurable debounce timing prevents excessive reloads
- Event listener limits can be configured to prevent memory leaks

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details 