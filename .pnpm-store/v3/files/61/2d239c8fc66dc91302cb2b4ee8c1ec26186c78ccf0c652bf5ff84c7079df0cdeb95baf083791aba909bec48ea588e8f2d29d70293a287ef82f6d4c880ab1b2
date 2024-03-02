"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aesDecrypt = exports.aesEncrypt = void 0;
const crypto_1 = __importDefault(require("crypto"));
/**
 * 编码
 * @param data
 * @param key
 */
function aesEncrypt(data, key) {
    const iv = key.substring(0, 16);
    const cipher = crypto_1.default.createCipheriv('aes-128-cbc', key, iv);
    let encrypted = cipher.update(data);
    return Buffer.concat([encrypted, cipher.final()]);
    ;
}
exports.aesEncrypt = aesEncrypt;
/**
 * 解码
 * @param encryptedData
 * @param key
 */
function aesDecrypt(encryptedData, key) {
    const iv = key.substring(0, 16);
    let encryptedText = Buffer.from(encryptedData, 'base64');
    let decipher = crypto_1.default.createDecipheriv('aes-128-cbc', key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}
exports.aesDecrypt = aesDecrypt;
