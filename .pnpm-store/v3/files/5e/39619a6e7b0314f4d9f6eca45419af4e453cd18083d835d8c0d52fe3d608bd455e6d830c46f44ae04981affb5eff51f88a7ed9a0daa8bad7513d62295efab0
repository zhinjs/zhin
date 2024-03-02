"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stream_1 = require("stream");
class Writer extends stream_1.PassThrough {
    writeU8(v) {
        const buf = Buffer.allocUnsafe(1);
        buf.writeUInt8(v);
        this.write(buf);
        return this;
    }
    writeU16(v) {
        const buf = Buffer.allocUnsafe(2);
        buf.writeUInt16BE(v);
        this.write(buf);
        return this;
    }
    write32(v) {
        const buf = Buffer.allocUnsafe(4);
        buf.writeInt32BE(v);
        this.write(buf);
        return this;
    }
    writeU32(v) {
        const buf = Buffer.allocUnsafe(4);
        buf.writeUInt32BE(v);
        this.write(buf);
        return this;
    }
    writeU64(v) {
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigUInt64BE(BigInt(v));
        this.write(buf);
        return this;
    }
    writeBytes(v) {
        if (typeof v === "string")
            v = Buffer.from(v);
        this.write(v);
        return this;
    }
    writeWithLength(v) {
        return this.writeU32(Buffer.byteLength(v) + 4).writeBytes(v);
    }
    writeTlv(v) {
        return this.writeU16(Buffer.byteLength(v)).writeBytes(v);
    }
}
exports.default = Writer;
