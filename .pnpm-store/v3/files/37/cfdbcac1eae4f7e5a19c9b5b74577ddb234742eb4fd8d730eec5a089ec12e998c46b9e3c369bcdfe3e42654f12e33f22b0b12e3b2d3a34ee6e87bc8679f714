# Silk Wasm

[![npm](https://img.shields.io/npm/v/silk-wasm?style=flat-square)](https://www.npmjs.com/package/silk-wasm)

QQ/微信语音编解码

## API
```ts
interface encodeResult {
    data: Uint8Array
    duration: number
}

interface decodeResult {
    data: Uint8Array
    duration: number
}
```

```ts
// pcm 转 silk。input 为 wav 或单声道 pcm_s16le 文件，samplingRate 为采样率。 
function encode(input: ArrayBufferView | ArrayBuffer, sampleRate: number): Promise<encodeResult>

// silk 转 pcm。input 为 silk 文件，samplingRate 为采样率。 
function decode(input: ArrayBufferView | ArrayBuffer, sampleRate: number): Promise<decodeResult>

// 获取 silk 音频时长，输出单位为毫秒。
function getDuration(silk: ArrayBufferView | ArrayBuffer, frameMs?: number): number
```

## Example

```js
import { encode } from './lib/index.mjs'  // use `silk-wasm` instead
import { readFile, writeFile } from 'fs/promises'

const pcm = await readFile('./testdata/canon.pcm')
const silk = await encode(pcm, 24000)
await writeFile('./test.silk', silk.data)
```

## Build wasm
```
cd binding
emcmake cmake .
emmake ninja
```