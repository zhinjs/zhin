# Installation
> `npm install --save @types/koa-basic-auth`

# Summary
This package contains type definitions for koa-basic-auth (https://github.com/koajs/basic-auth).

# Details
Files were exported from https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/koa-basic-auth.
## [index.d.ts](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/koa-basic-auth/index.d.ts)
````ts
import * as Koa from "koa";

declare function auth(opts: {
    name: string;
    pass: string;
}): Koa.Middleware;

export = auth;

````

### Additional Details
 * Last updated: Tue, 07 Nov 2023 09:09:38 GMT
 * Dependencies: [@types/koa](https://npmjs.com/package/@types/koa)

# Credits
These definitions were written by [Tobias Wolff](https://github.com/Tobias4872).
