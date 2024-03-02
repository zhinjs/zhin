
var zlib = require('zlib')

module.exports = inflate

function inflate(stream, options) {
  if (!stream) {
    throw new TypeError('argument stream is required')
  }

  options = options || {}

  var encoding = options.encoding
    || (stream.headers && stream.headers['content-encoding'])
    || 'identity'
  
  var decompression
  switch (encoding) {
  case 'gzip':
  case 'deflate':
    delete options.brotli
    delete options.encoding
    decompression = zlib.createUnzip(options)
    break
  case 'br':
    if (zlib.createBrotliDecompress) {
      decompression = zlib.createBrotliDecompress(options.brotli)
    }
    break
  case 'identity':
    return stream
  }

  if (!decompression) {
    var err = new Error('Unsupported Content-Encoding: ' + encoding)
    err.status = 415
    throw err
  }

  return stream.pipe(decompression)
}
