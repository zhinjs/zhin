"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptPKCS1 = void 0;
const crypto_1 = __importDefault(require("crypto"));
function encryptPKCS1(pemStr, encryptKey) {
    const publicKey = crypto_1.default.createPublicKey(pemStr);
    return crypto_1.default.publicEncrypt({
        key: publicKey, padding: crypto_1.default.constants.RSA_PKCS1_PADDING
    }, Buffer.from(encryptKey)).toString('base64');
}
exports.encryptPKCS1 = encryptPKCS1;
