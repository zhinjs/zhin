import {h,renderToString,jsx,jsxs,jsxDEV,JSXChild,JSXElement,Fragment} from '@zhinjs/core'

export namespace JSX {
  export interface Element extends JSXElement {}
  export interface IntrinsicElements {
    face:{
      id:string
    }
    image:{
      url:string
    }
    video:{
      url:string
    }
    audio:{
      url:string
    }
  }

  export interface ElementAttributesProperty {
    props: {};
  }

  export interface ElementChildrenAttribute {
    children: {};
  }
}

export {
  h,
  jsx,
  renderToString,
  JSXChild,
  JSXElement,
  Fragment,
  jsxs,
  jsxDEV
}
export default {
  h,
  jsx,
  renderToString,
  JSXChild,
  JSXElement,
  Fragment,
  jsxs,
  jsxDEV
}
