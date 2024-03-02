# Installation
> `npm install --save @types/svgdom`

# Summary
This package contains type definitions for svgdom (https://github.com/svgdotjs/svgdom#readme).

# Details
Files were exported from https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/svgdom.
## [index.d.ts](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/svgdom/index.d.ts)
````ts
// Minimum TypeScript Version: 4.5

export function createSVGWindow(): SVGWindow;
export function createSVGDocument(): SVGDocument;

export function createWindow(): Window;
export function createDocument(): Document;

export function createHTMLWindow(): Window;
export function createHTMLDocument(): Document;

export interface SVGDocument extends Document {
    documentElement: HTMLElement & SVGSVGElement;
}

export interface SVGWindow extends Window {
    document: SVGDocument;
}

````

### Additional Details
 * Last updated: Tue, 07 Nov 2023 15:11:36 GMT
 * Dependencies: none

# Credits
These definitions were written by [Alan Norbauer](https://github.com/altano).
