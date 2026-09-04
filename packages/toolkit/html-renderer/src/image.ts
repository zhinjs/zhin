import zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CHANNELS: Record<number, number> = {
  0: 1,
  2: 3,
  4: 2,
  6: 4,
};

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

interface PngChunk {
  type: string;
  data: Buffer;
}

function readChunks(buf: Buffer): PngChunk[] | null {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buf.length) return null;
    chunks.push({ type, data: buf.subarray(start, end) });
    offset = end + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

function writeChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export function readImageSize(buf: Buffer): { width: number; height: number } | null {
  const png = readPngInfo(buf);
  if (png) return { width: png.width, height: png.height };
  return readJpegSize(buf) ?? readWebpSize(buf);
}

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

export function readPngInfo(buf: Buffer): PngInfo | null {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;

  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24]!,
    colorType: buf[25]!,
    interlace: buf[28]!,
  };
}

function readJpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1]!;
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function readWebpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      width: (buf.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (buf.readUIntLE(27, 3) & 0xffffff) + 1,
    };
  }
  if (chunk === 'VP8 ') {
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(filtered: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const filterType = filtered[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = filtered[src + x]!;
      const a = x >= bpp ? out[dst + x - bpp]! : 0;
      const b = y > 0 ? out[up + x]! : 0;
      const c = x >= bpp && y > 0 ? out[up + x - bpp]! : 0;

      let value: number;
      switch (filterType) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + a; break;
        case 2: value = rawByte + b; break;
        case 3: value = rawByte + ((a + b) >> 1); break;
        case 4: value = rawByte + paeth(a, b, c); break;
        default: value = rawByte;
      }
      out[dst + x] = value & 0xff;
    }
  }

  return out;
}

export function splitPng(buf: Buffer, sliceHeight: number, level = 3): Buffer[] | null {
  const info = readPngInfo(buf);
  if (!info) return null;
  if (info.interlace !== 0 || info.bitDepth !== 8) return null;

  const channels = CHANNELS[info.colorType];
  if (!channels) return null;

  const height = Math.max(1, Math.floor(sliceHeight));
  if (height >= info.height) return [buf];

  const chunks = readChunks(buf);
  if (!chunks) return null;

  const idat = chunks.filter((item) => item.type === 'IDAT').map((item) => item.data);
  if (idat.length === 0) return null;

  let inflated: Buffer;
  try {
    inflated = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }

  const stride = info.width * channels;
  if (inflated.length < (stride + 1) * info.height) return null;

  const pixels = unfilter(inflated, info.width, info.height, channels);
  const extras = chunks.filter((item) =>
    ['PLTE', 'tRNS', 'gAMA', 'sRGB', 'cHRM', 'iCCP', 'pHYs'].includes(item.type));

  const list: Buffer[] = [];
  for (let top = 0; top < info.height; top += height) {
    const sliceRows = Math.min(height, info.height - top);
    const body = Buffer.alloc((stride + 1) * sliceRows);
    for (let y = 0; y < sliceRows; y++) {
      body[y * (stride + 1)] = 0;
      pixels.copy(body, y * (stride + 1) + 1, (top + y) * stride, (top + y + 1) * stride);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(info.width, 0);
    ihdr.writeUInt32BE(sliceRows, 4);
    ihdr[8] = info.bitDepth;
    ihdr[9] = info.colorType;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    list.push(Buffer.concat([
      PNG_SIGNATURE,
      writeChunk('IHDR', ihdr),
      ...extras.map((item) => writeChunk(item.type, item.data)),
      writeChunk('IDAT', zlib.deflateSync(body, { level })),
      writeChunk('IEND', Buffer.alloc(0)),
    ]));
  }

  return list;
}
