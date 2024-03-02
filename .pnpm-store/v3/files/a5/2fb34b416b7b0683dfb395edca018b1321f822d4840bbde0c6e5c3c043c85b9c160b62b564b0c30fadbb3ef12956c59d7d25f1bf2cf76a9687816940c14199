"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.headerTrim = void 0;
const message_1 = __importDefault(require("@commitlint/message"));
const headerTrim = (parsed) => {
    const { header } = parsed;
    const startsWithWhiteSpace = header !== header.trimStart();
    const endsWithWhiteSpace = header !== header.trimEnd();
    switch (true) {
        case startsWithWhiteSpace && endsWithWhiteSpace:
            return [
                false,
                (0, message_1.default)(['header', 'must not be surrounded by whitespace']),
            ];
        case startsWithWhiteSpace:
            return [false, (0, message_1.default)(['header', 'must not start with whitespace'])];
        case endsWithWhiteSpace:
            return [false, (0, message_1.default)(['header', 'must not end with whitespace'])];
        default:
            return [true];
    }
};
exports.headerTrim = headerTrim;
//# sourceMappingURL=header-trim.js.map