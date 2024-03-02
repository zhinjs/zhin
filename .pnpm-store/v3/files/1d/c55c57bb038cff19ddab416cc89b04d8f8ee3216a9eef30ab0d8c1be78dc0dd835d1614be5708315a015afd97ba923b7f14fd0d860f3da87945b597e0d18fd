# inflation

[![NPM version](https://badge.fury.io/js/inflation.svg)](http://badge.fury.io/js/inflation)
[![CI](https://github.com/stream-utils/inflation/actions/workflows/nodejs.yml/badge.svg)](https://github.com/stream-utils/inflation/actions/workflows/nodejs.yml)

Automatically unzip an HTTP stream.

## API

```js
var inflate = require('inflation')
```

### inflate(stream, options)

Returns a stream that emits inflated data from the given stream.

Options:

- `encoding` - The encoding of the stream (`gzip` or `deflate`).
  If not given, will look in `stream.headers['content-encoding']`.
- `brotli` - [`BrotliOptions`](https://nodejs.org/api/zlib.html#class-brotlioptions) to use for Brotli decompression

## Example

```js
var inflate = require('inflation')
var raw     = require('raw-body')

http.createServer(function (req, res) {
  raw(inflate(req), 'utf-8', function (err, string) {
    console.dir(string)
  })
})
```

<!-- GITCONTRIBUTOR_START -->

## Contributors

|[<img src="https://avatars.githubusercontent.com/u/67512?v=4" width="100px;"/><br/><sub><b>dougwilson</b></sub>](https://github.com/dougwilson)<br/>|[<img src="https://avatars.githubusercontent.com/u/73755?v=4" width="100px;"/><br/><sub><b>bminer</b></sub>](https://github.com/bminer)<br/>|[<img src="https://avatars.githubusercontent.com/u/156269?v=4" width="100px;"/><br/><sub><b>fengmk2</b></sub>](https://github.com/fengmk2)<br/>|
| :---: | :---: | :---: |


This project follows the git-contributor [spec](https://github.com/xudafeng/git-contributor), auto updated at `Sat Oct 14 2023 12:55:08 GMT+0800`.

<!-- GITCONTRIBUTOR_END -->
