"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var client_1 = require("@zhin.js/client");
(0, client_1.addPage)({
    parentName: 'Zhin',
    path: '/test',
    name: "Test",
    component: function () { return Promise.resolve().then(function () { return require('./test.vue'); }); }
});
