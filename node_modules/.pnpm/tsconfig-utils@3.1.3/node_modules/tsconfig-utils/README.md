# tsconfig-utils

[![npm](https://img.shields.io/npm/v/tsconfig-utils?style=flat-square)](https://www.npmjs.com/package/tsconfig-utils)

A collection of utilities for working with `tsconfig.json` files.

## Usage

```ts
import { load } from 'tsconfig-utils'

// load a tsconfig.json file,
// resolving "extends" fields recursively
const config = await load('/path/to/project')

config.get('noEmit') // false

// load with additional args
// args will take precedence over tsconfig files
const config = await load(process.cwd(), [
  '-p', 'tsconfig.base.json',
  '--noEmit',
])

config.get('noEmit') // true
```
