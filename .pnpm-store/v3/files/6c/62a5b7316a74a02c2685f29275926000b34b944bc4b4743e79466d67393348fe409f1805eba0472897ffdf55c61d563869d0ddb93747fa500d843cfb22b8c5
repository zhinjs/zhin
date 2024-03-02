"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const constants_1 = require("./constants");
const OICQ_PUBLIC_KEY = Buffer.from("04EBCA94D733E399B2DB96EACDD3F69A8BB0F74224E2B44E3357812211D2E62EFBC91BB553098E25E33A799ADC7F76FEB208DA7C6522CDB0719A305180CC54A82E", "hex");
// const v2 = Buffer.from("0440eaf325b9c66225143aa7f3961c953c3d5a8048c2b73293cdc7dcbab7f35c4c66aa8917a8fd511f9d969d02c8501bcaa3e3b11746f00567e3aea303ac5f2d25", "hex")
class Ecdh {
    constructor() {
        this.ecdh = (0, crypto_1.createECDH)("prime256v1");
        this.public_key = this.ecdh.generateKeys();
        this.share_key = (0, constants_1.md5)(this.ecdh.computeSecret(OICQ_PUBLIC_KEY).slice(0, 16));
    }
}
exports.default = Ecdh;
