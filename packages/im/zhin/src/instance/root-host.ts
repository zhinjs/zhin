import {
  RootHost as BaseRootHost,
  describeSnapshot,
  type RootHostOptions,
  type RootHostSnapshot,
} from '@zhin.js/runtime';
import { createTsxModuleLoader } from './start/module.js';

export { describeSnapshot, type RootHostOptions, type RootHostSnapshot };

export class RootHost extends BaseRootHost {
  constructor(options: RootHostOptions) {
    super({ defaultTsxLoader: createTsxModuleLoader, ...options });
  }
}
